// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./ILendingPool.sol";

/**
 * @title FlashLoanTester
 * @dev Simple contract for testing flash loans
 */
contract FlashLoanTester {
    ILendingPool public lendingPool;
    
    constructor(address _lendingPoolAddress) {
        lendingPool = ILendingPool(_lendingPoolAddress);
    }
    
    function executeFlashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        bytes calldata params
    ) external {
        lendingPool.flashLoan(
            receiverAddress,
            assets,
            amounts,
            modes,
            address(this),
            params,
            0 // referral code
        );
    }
    
    // Function to receive ETH
    receive() external payable {}
}