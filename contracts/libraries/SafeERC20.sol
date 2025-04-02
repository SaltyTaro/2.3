// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "../interfaces/IERC20.sol";


/**
 * @title SafeERC20
 * @dev Wrappers around ERC20 operations that throw on failure
 */
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        require(token.transfer(to, value), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        require(token.transferFrom(from, to, value), "SafeERC20: transferFrom failed");
    }

    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        // To change the approve amount you first have to reduce the addresses`
        // allowance to zero by calling `approve(spender, 0)` if it is not
        // already 0 to mitigate the race condition described in:
        // https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
        if (value > 0 && token.allowance(address(this), spender) > 0) {
            require(token.approve(spender, 0), "SafeERC20: approve failed");
        }
        require(token.approve(spender, value), "SafeERC20: approve failed");
    }
}