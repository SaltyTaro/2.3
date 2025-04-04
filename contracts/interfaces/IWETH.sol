// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./IERC20.sol";  // Relative path from interfaces folder

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}