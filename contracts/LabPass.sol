// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LabPass v2 - peminjaman alat lab dengan status dan hak akses on-chain
/// @notice Setiap akun aplikasi punya alamat wallet sendiri. Kontrak menentukan siapa
///         boleh memanggil fungsi dan urutan status peminjaman, terlepas dari pengecekan backend.
///         Batasan MVP: kunci semua wallet masih dipegang backend (custodial).
contract LabPass {
    enum Role { None, Student, Staff }
    enum Status { None, Requested, Approved, HandoverPending, Borrowed, ReturnRequested, ReturnPending, Closed, Rejected, Cancelled }

    struct Loan {
        bytes32 assetId;
        address borrower;
        address staff;
        Status status;
        bool flagInspection; // diisi petugas saat memeriksa pengembalian
        uint64 updatedAt;
    }

    struct Proof {
        bytes32 digest;
        uint256 recordedAt;
    }

    address public immutable admin;
    mapping(address => Role) public roles;
    mapping(bytes32 => Loan) public loans;
    mapping(bytes32 => Proof) public proofs;
    mapping(bytes32 => bytes32) public activeLoanOf;    // assetId => peminjaman yang sedang memegang unit
    mapping(bytes32 => bool) public needsInspection;    // assetId => unit harus diperiksa sebelum dipinjam lagi
    mapping(bytes32 => bytes32) public lastDigestOf;    // assetId => bukti terakhir (ujung "paspor" alat)

    event RoleSet(address indexed account, Role role);
    event LoanStatusChanged(bytes32 indexed loanId, bytes32 indexed assetId, address indexed actor, Status from, Status to);
    event EvidenceRecorded(bytes32 indexed recordId, bytes32 indexed assetId, bytes32 indexed loanId, bytes32 digest, bytes32 previousDigest, uint256 recordedAt);
    event AssetReleased(bytes32 indexed assetId, address indexed actor);

    error Unauthorized();
    error ZeroAddress();
    error NotStudent();
    error NotStaff();
    error NotBorrower();
    error LoanExists();
    error LoanNotFound();
    error InvalidStatus(Status current);
    error AssetUnavailable();
    error AssetInUse();
    error AlreadyRecorded();
    error EmptyDigest();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyStaff() {
        if (roles[msg.sender] != Role.Staff) revert NotStaff();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // ---------- Administrasi ----------

    /// @notice Admin (akun deploy) mendaftarkan wallet mahasiswa dan petugas.
    function setRole(address account, Role role) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        roles[account] = role;
        emit RoleSet(account, role);
    }

    /// @notice Pencatatan bukti tanpa transisi status. Dipakai untuk transaksi yang dibuat sebelum v2.
    function recordEvidence(bytes32 recordId, bytes32 digest) external onlyAdmin {
        _record(recordId, bytes32(0), bytes32(0), digest);
    }

    // ---------- Alur peminjaman ----------

    function requestLoan(bytes32 loanId, bytes32 assetId) external {
        if (roles[msg.sender] != Role.Student) revert NotStudent();
        if (loans[loanId].status != Status.None) revert LoanExists();
        if (activeLoanOf[assetId] != bytes32(0) || needsInspection[assetId]) revert AssetUnavailable();
        loans[loanId] = Loan(assetId, msg.sender, address(0), Status.Requested, false, uint64(block.timestamp));
        emit LoanStatusChanged(loanId, assetId, msg.sender, Status.None, Status.Requested);
    }

    function approve(bytes32 loanId) external onlyStaff {
        Loan storage loan = _loanIn(loanId, Status.Requested);
        if (activeLoanOf[loan.assetId] != bytes32(0) || needsInspection[loan.assetId]) revert AssetUnavailable();
        activeLoanOf[loan.assetId] = loanId;
        loan.staff = msg.sender;
        _move(loanId, loan, Status.Approved);
    }

    function reject(bytes32 loanId) external onlyStaff {
        Loan storage loan = _loanIn(loanId, Status.Requested);
        _move(loanId, loan, Status.Rejected);
    }

    /// @notice Peminjam membatalkan sebelum menerima alat. digest boleh nol jika belum ada pemeriksaan awal.
    function cancel(bytes32 loanId, bytes32 recordId, bytes32 digest) external {
        Loan storage loan = _borrowerLoan(loanId);
        Status current = loan.status;
        if (current != Status.Requested && current != Status.Approved && current != Status.HandoverPending) revert InvalidStatus(current);
        if (current != Status.Requested) delete activeLoanOf[loan.assetId];
        if (digest != bytes32(0)) _record(recordId, loan.assetId, loanId, digest);
        _move(loanId, loan, Status.Cancelled);
    }

    function handover(bytes32 loanId, bytes32 recordId, bytes32 digest) external onlyStaff {
        Loan storage loan = _loanIn(loanId, Status.Approved);
        _record(recordId, loan.assetId, loanId, digest);
        _move(loanId, loan, Status.HandoverPending);
    }

    function confirmPickup(bytes32 loanId, bytes32 recordId, bytes32 digest) external {
        Loan storage loan = _borrowerLoan(loanId);
        _requireStatus(loan, Status.HandoverPending);
        _record(recordId, loan.assetId, loanId, digest);
        _move(loanId, loan, Status.Borrowed);
    }

    function requestReturn(bytes32 loanId) external {
        Loan storage loan = _borrowerLoan(loanId);
        _requireStatus(loan, Status.Borrowed);
        _move(loanId, loan, Status.ReturnRequested);
    }

    /// @param flagInspection true jika alat kurang lengkap atau rusak sehingga harus diperiksa.
    function inspectReturn(bytes32 loanId, bytes32 recordId, bytes32 digest, bool flagInspection) external onlyStaff {
        Loan storage loan = _loanIn(loanId, Status.ReturnRequested);
        loan.flagInspection = flagInspection;
        _record(recordId, loan.assetId, loanId, digest);
        _move(loanId, loan, Status.ReturnPending);
    }

    function confirmReturn(bytes32 loanId, bytes32 recordId, bytes32 digest) external {
        Loan storage loan = _borrowerLoan(loanId);
        _requireStatus(loan, Status.ReturnPending);
        delete activeLoanOf[loan.assetId];
        needsInspection[loan.assetId] = loan.flagInspection;
        _record(recordId, loan.assetId, loanId, digest);
        _move(loanId, loan, Status.Closed);
    }

    /// @notice Petugas menandai unit selesai diperiksa dan boleh dipinjam lagi.
    function releaseAsset(bytes32 assetId) external onlyStaff {
        if (activeLoanOf[assetId] != bytes32(0)) revert AssetInUse();
        needsInspection[assetId] = false;
        emit AssetReleased(assetId, msg.sender);
    }

    // ---------- Internal ----------

    function _loanIn(bytes32 loanId, Status expected) private view returns (Loan storage loan) {
        loan = loans[loanId];
        if (loan.status == Status.None) revert LoanNotFound();
        _requireStatus(loan, expected);
    }

    function _borrowerLoan(bytes32 loanId) private view returns (Loan storage loan) {
        loan = loans[loanId];
        if (loan.status == Status.None) revert LoanNotFound();
        if (msg.sender != loan.borrower) revert NotBorrower();
    }

    function _requireStatus(Loan storage loan, Status expected) private view {
        if (loan.status != expected) revert InvalidStatus(loan.status);
    }

    function _move(bytes32 loanId, Loan storage loan, Status next) private {
        Status previous = loan.status;
        loan.status = next;
        loan.updatedAt = uint64(block.timestamp);
        emit LoanStatusChanged(loanId, loan.assetId, msg.sender, previous, next);
    }

    function _record(bytes32 recordId, bytes32 assetId, bytes32 loanId, bytes32 digest) private {
        if (digest == bytes32(0)) revert EmptyDigest();
        if (proofs[recordId].recordedAt != 0) revert AlreadyRecorded();
        proofs[recordId] = Proof(digest, block.timestamp);
        bytes32 previous = lastDigestOf[assetId];
        if (assetId != bytes32(0)) lastDigestOf[assetId] = digest;
        emit EvidenceRecorded(recordId, assetId, loanId, digest, previous, block.timestamp);
    }
}
