// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Single-custodian evidence anchoring. App confirmations are NOT independent wallet signatures.
contract LabPass {
    address public immutable operator;
    struct Proof { bytes32 digest; uint256 recordedAt; }
    mapping(bytes32 => Proof) public proofs;
    event EvidenceRecorded(bytes32 indexed recordId, bytes32 digest, uint256 recordedAt);
    error Unauthorized();
    error AlreadyRecorded();
    error EmptyDigest();

    constructor() { operator = msg.sender; }
    function recordEvidence(bytes32 recordId, bytes32 digest) external {
        if (msg.sender != operator) revert Unauthorized();
        if (digest == bytes32(0)) revert EmptyDigest();
        if (proofs[recordId].recordedAt != 0) revert AlreadyRecorded();
        proofs[recordId] = Proof(digest, block.timestamp);
        emit EvidenceRecorded(recordId, digest, block.timestamp);
    }
}
