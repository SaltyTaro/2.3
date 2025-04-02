// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

// Import interfaces
import "./interfaces/IFlashLoanReceiver.sol";
import "./interfaces/ILendingPool.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IWETH.sol";
import "./libraries/SafeERC20.sol";
import "./libraries/SafeMath.sol";

/**
 * @title FlashLoanSandwich
 * @dev Contract for executing sandwich attacks using flash loans
 */
contract FlashLoanSandwich is IFlashLoanReceiver {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Constants for fee calculations
    uint256 private constant BIPS_DIVISOR = 10000;
    uint256 private constant AAVE_FEE = 9; // 0.09% for Aave flash loans

    // Protocol interfaces
    ILendingPool public immutable lendingPool;
    IUniswapV2Router02 public immutable uniswapRouter;
    address public immutable weth;
    address public immutable owner;

    // Configuration parameters
    uint256 public minProfitThreshold;
    uint256 public maxGasPrice;
    bool public emergencyStop;

    // Temporary storage variables to avoid stack too deep
    struct FlashLoanVars {
        address tokenA;
        address tokenB;
        uint256 loanAmount;
        uint256 profit;
    }
    FlashLoanVars private flashLoanVars;

    // Events for tracking and monitoring
    event SandwichExecuted(
        address indexed tokenA,
        address indexed tokenB,
        uint256 loanAmount,
        uint256 profit,
        uint256 gasUsed,
        uint256 timestamp
    );

    event EmergencyWithdrawal(
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    event ParametersUpdated(
        uint256 minProfitThreshold,
        uint256 maxGasPrice,
        uint256 timestamp
    );

    /**
     * @dev Modifier to restrict functions to contract owner
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    /**
     * @dev Modifier to check emergency stop status
     */
    modifier notStopped() {
        require(!emergencyStop, "Contract is in emergency stop mode");
        _;
    }

    /**
     * @dev Modifier to check gas price against maximum
     */
    modifier checkGasPrice() {
        require(tx.gasprice <= maxGasPrice, "Gas price exceeds maximum");
        _;
    }

    /**
     * @dev Constructor to initialize contract parameters
     * @param _lendingPoolAddress Aave lending pool address
     * @param _uniswapRouterAddress Uniswap router address
     * @param _weth WETH token address
     * @param _minProfitThreshold Minimum profit threshold in wei
     * @param _maxGasPrice Maximum gas price in wei
     */
    constructor(
        address _lendingPoolAddress,
        address _uniswapRouterAddress,
        address _weth,
        uint256 _minProfitThreshold,
        uint256 _maxGasPrice
    ) {
        lendingPool = ILendingPool(_lendingPoolAddress);
        uniswapRouter = IUniswapV2Router02(_uniswapRouterAddress);
        weth = _weth;
        minProfitThreshold = _minProfitThreshold;
        maxGasPrice = _maxGasPrice;
        emergencyStop = false;
        owner = msg.sender;
    }

    /**
     * @dev Executes a sandwich attack using flash loans
     * @param tokenA First token in the pair (flash loan currency)
     * @param tokenB Second token in the pair
     * @param loanAmount Amount to borrow in flash loan
     * @param frontRunAmount Amount to use in front-run swap
     * @param victimAmountMin Minimum victim swap amount to proceed
     * @param victimAmountMax Maximum victim swap amount to proceed
     * @param backRunAmount Amount to use in back-run swap
     * @param deadline Transaction deadline timestamp
     */
    function executeSandwich(
        address tokenA,
        address tokenB,
        uint256 loanAmount,
        uint256 frontRunAmount,
        uint256 victimAmountMin,
        uint256 victimAmountMax,
        uint256 backRunAmount,
        uint256 deadline
    ) external onlyOwner notStopped checkGasPrice {
        require(block.timestamp <= deadline, "Transaction deadline expired");
        require(tokenA != address(0) && tokenB != address(0), "Invalid token addresses");
        require(loanAmount > 0, "Loan amount must be greater than 0");

        // Store tokenA, tokenB, and loanAmount in storage for the callback
        flashLoanVars.tokenA = tokenA;
        flashLoanVars.tokenB = tokenB;
        flashLoanVars.loanAmount = loanAmount;

        // Request flash loan
        address[] memory assets = new address[](1);
        assets[0] = tokenA;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;

        // 0 = no debt, 1 = stable, 2 = variable
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;

        // Encode execution parameters for the callback
        bytes memory params = abi.encode(
            tokenA,
            tokenB,
            frontRunAmount,
            victimAmountMin,
            victimAmountMax,
            backRunAmount,
            deadline
        );

        // Execute flash loan
        lendingPool.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0
        );
    }

    /**
     * @dev Executes a sandwich attack directly with ETH
     * @notice This function allows sandwich execution without a flash loan
     * @param tokenB Second token in the pair (WETH is tokenA)
     * @param frontRunAmount Amount to use in front-run swap
     * @param victimAmountMin Minimum victim swap amount to proceed
     * @param victimAmountMax Maximum victim swap amount to proceed
     * @param backRunAmount Amount to use in back-run swap
     * @param deadline Transaction deadline timestamp
     */
    function executeSandwichWithETH(
        address tokenB,
        uint256 frontRunAmount,
        uint256 victimAmountMin,
        uint256 victimAmountMax,
        uint256 backRunAmount,
        uint256 deadline
    ) external payable onlyOwner notStopped checkGasPrice {
        require(block.timestamp <= deadline, "Transaction deadline expired");
        require(tokenB != address(0), "Invalid token address");
        require(msg.value >= frontRunAmount, "Insufficient ETH sent");

        // Wrap ETH to WETH
        IWETH(weth).deposit{value: frontRunAmount}();

        // Track initial balance for profit calculation
        uint256 initialWETHBalance = IERC20(weth).balanceOf(address(this));

        // Step 1: Execute front-run (WETH -> token B)
        _executeFrontRunWithPath(weth, tokenB, frontRunAmount);

        // Step 2: Wait for victim transaction to execute naturally
        // This happens between our transaction execution

        // Step 3: Execute back-run (token B -> WETH)
        uint256 tokenBBalance = IERC20(tokenB).balanceOf(address(this));
        uint256 actualBackRunAmount = backRunAmount > tokenBBalance ? tokenBBalance : backRunAmount;
        _executeBackRunWithPath(tokenB, weth, actualBackRunAmount);

        // Calculate profit
        uint256 finalWETHBalance = IERC20(weth).balanceOf(address(this));
        require(finalWETHBalance > initialWETHBalance, "Sandwich not profitable");
        uint256 profit = finalWETHBalance - initialWETHBalance;
        require(profit >= minProfitThreshold, "Profit below threshold");

        // Unwrap WETH back to ETH
        IWETH(weth).withdraw(finalWETHBalance);

        // Send profit to owner
        (bool success, ) = owner.call{value: address(this).balance}("");
        require(success, "ETH transfer failed");

        // Emit event
        emit SandwichExecuted(
            weth,
            tokenB,
            msg.value,
            profit,
            gasleft(),
            block.timestamp
        );
    }

    /**
     * @dev Flash loan callback function executed by the lending pool
     * @param assets Array of asset addresses
     * @param amounts Array of loan amounts
     * @param premiums Array of premiums (fees)
     * @param initiator Address that initiated the flash loan
     * @param params Additional parameters for execution
     * @return boolean indicating successful execution
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Verify callback is from lending pool
        require(msg.sender == address(lendingPool), "Invalid caller");
        require(initiator == address(this), "Invalid initiator");

        // Store frequently accessed values to reduce stack usage
        address asset = assets[0];
        uint256 amount = amounts[0];
        uint256 premium = premiums[0];
        
        // Using storage variables from flashLoanVars for tokenA and tokenB
        // Decode only what we need from params to reduce stack variables
        (
            ,  // tokenA - already stored in flashLoanVars
            ,  // tokenB - already stored in flashLoanVars
            uint256 frontRunAmount,
            ,  // victimAmountMin - unused
            ,  // victimAmountMax - unused
            uint256 backRunAmount,
            uint256 deadline
        ) = abi.decode(params, (address, address, uint256, uint256, uint256, uint256, uint256));

        // Verify parameters
        require(block.timestamp <= deadline, "Transaction deadline expired");
        require(frontRunAmount <= amount, "Front-run amount exceeds loan amount");

        // Execute the sandwich operations and get profit
        uint256 profit = _executeSandwichOperation(
            asset,
            amount,
            premium,
            flashLoanVars.tokenA,
            flashLoanVars.tokenB,
            frontRunAmount,
            backRunAmount
        );

        // Set profit in storage for the event
        flashLoanVars.profit = profit;

        // Emit success event
        emit SandwichExecuted(
            flashLoanVars.tokenA,
            flashLoanVars.tokenB,
            amount,
            profit,
            gasleft(),
            block.timestamp
        );

        return true;
    }

    /**
     * @dev Helper function to execute sandwich operation steps
     * @param asset Asset being borrowed
     * @param amount Amount borrowed
     * @param premium Fee for the flash loan
     * @param tokenA Token A address
     * @param tokenB Token B address
     * @param frontRunAmount Amount for front-run
     * @param backRunAmount Amount for back-run
     * @return profit The profit from the operation
     */
    function _executeSandwichOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address tokenA,
        address tokenB,
        uint256 frontRunAmount,
        uint256 backRunAmount
    ) internal returns (uint256 profit) {
        // Track initial balance for profit calculation
        uint256 initialBalance = IERC20(asset).balanceOf(address(this));

        // Step 1: Execute front-run (token A -> token B)
        _executeFrontRunWithPath(tokenA, tokenB, frontRunAmount);

        // Step 2: Wait for victim transaction to execute naturally
        // This happens between our transaction execution

        // Step 3: Execute back-run (token B -> token A)
        uint256 tokenBBalance = IERC20(tokenB).balanceOf(address(this));
        uint256 actualBackRunAmount = backRunAmount > tokenBBalance ? tokenBBalance : backRunAmount;
        _executeBackRunWithPath(tokenB, tokenA, actualBackRunAmount);

        // Calculate profit
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        uint256 amountOwing = amount + premium;
        require(finalBalance >= amountOwing, "Insufficient funds to repay flash loan");

        profit = finalBalance - initialBalance - premium;
        require(profit >= minProfitThreshold, "Profit below threshold");

        // Approve the lending pool to withdraw the owed amount
        IERC20(asset).safeApprove(address(lendingPool), amountOwing);

        return profit;
    }

    /**
     * @dev Internal function to execute front-run swap
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of input token to swap
     */
    function _executeFrontRunWithPath(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal {
        // Approve router to spend input token
        IERC20(tokenIn).safeApprove(address(uniswapRouter), amountIn);

        // Prepare swap path
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        // Execute swap
        uniswapRouter.swapExactTokensForTokens(
            amountIn,
            1, // Accept any amount (would be calculated properly in real implementation)
            path,
            address(this),
            block.timestamp + 300 // 5 minute deadline
        );

        // Reset approval
        IERC20(tokenIn).safeApprove(address(uniswapRouter), 0);
    }

    /**
     * @dev Internal function to execute back-run swap
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of input token to swap
     */
    function _executeBackRunWithPath(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal {
        if (amountIn == 0) return;

        // Approve router to spend input token
        IERC20(tokenIn).safeApprove(address(uniswapRouter), amountIn);

        // Prepare swap path
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        // Execute swap
        uniswapRouter.swapExactTokensForTokens(
            amountIn,
            1, // Accept any amount (would be calculated properly in real implementation)
            path,
            address(this),
            block.timestamp + 300 // 5 minute deadline
        );

        // Reset approval
        IERC20(tokenIn).safeApprove(address(uniswapRouter), 0);
    }

    /**
     * @dev Get pair address and reserves for a token pair
     */
    function _getPairAndReserves(
        address tokenA, 
        address tokenB
    ) internal view returns (address pair, uint256 reserveA, uint256 reserveB) {
        address factory = uniswapRouter.factory();
        pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
        
        require(pair != address(0), "Pair does not exist");
        
        (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair).getReserves();
        
        if (tokenA < tokenB) {
            reserveA = uint256(reserve0);
            reserveB = uint256(reserve1);
        } else {
            reserveA = uint256(reserve1);
            reserveB = uint256(reserve0);
        }
    }
    
    /**
     * @dev Calculate sandwich results (front-run, victim, back-run)
     */
    function _calculateSandwichResults(
        uint256 reserveA,
        uint256 reserveB,
        uint256 frontRunAmount,
        uint256 victimAmount,
        uint256 backRunAmount
    ) internal pure returns (uint256 amountOut1, uint256 amountOut3) {
        // Calculate front-run result
        amountOut1 = getAmountOut(frontRunAmount, reserveA, reserveB);
        
        // Update reserves after front-run
        uint256 newReserveA = reserveA + frontRunAmount;
        uint256 newReserveB = reserveB - amountOut1;
        
        // Skip victim calculation since we only need reserves after victim
        uint256 victimOut = getAmountOut(victimAmount, newReserveA, newReserveB);
        
        // Update reserves after victim
        newReserveA = newReserveA + victimAmount;
        newReserveB = newReserveB - victimOut;
        
        // Calculate back-run result
        uint256 actualBackRunAmount = amountOut1 < backRunAmount ? amountOut1 : backRunAmount;
        amountOut3 = getAmountOut(actualBackRunAmount, newReserveB, newReserveA);
    }
    
    /**
     * @dev Calculate flash loan fee and gas costs
     */
    function _calculateCosts(
        uint256 loanAmount
    ) internal view returns (uint256) {
        uint256 flashLoanFee = loanAmount * AAVE_FEE / BIPS_DIVISOR;
        uint256 gasCost = 600000 * tx.gasprice;
        return flashLoanFee + gasCost;
    }

    /**
     * @dev Simulates a sandwich attack to calculate potential profit
     * Split into multiple functions to avoid stack too deep errors
     */
    function simulateSandwich(
        address tokenA,
        address tokenB,
        uint256 loanAmount,
        uint256 frontRunAmount,
        uint256 victimAmount,
        uint256 backRunAmount
    ) external view returns (uint256 estimatedProfit, bool profitable) {
        // Step 1: Get pair and reserves
        (address pair, uint256 reserveA, uint256 reserveB) = _getPairAndReserves(tokenA, tokenB);
        
        // Step 2: Calculate swap results through the sandwich
        (uint256 amountOut1, uint256 amountOut3) = _calculateSandwichResults(
            reserveA,
            reserveB,
            frontRunAmount,
            victimAmount,
            backRunAmount
        );
        
        // Step 3: Calculate costs (flash loan fee + gas)
        uint256 costs = _calculateCosts(loanAmount);
        
        // Step 4: Calculate profit
        uint256 grossProfit = 0;
        if (amountOut3 > frontRunAmount) {
            grossProfit = amountOut3 - frontRunAmount;
        }
        
        // Return results
        if (grossProfit > costs) {
            estimatedProfit = grossProfit - costs;
            profitable = grossProfit > (costs + minProfitThreshold);
        } else {
            estimatedProfit = 0;
            profitable = false;
        }
    }

    /**
     * @dev Calculates output amount for a swap based on Uniswap V2 formula
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_LIQUIDITY");
        
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /**
     * @dev Toggles the emergency stop status
     */
    function toggleEmergencyStop() external onlyOwner {
        emergencyStop = !emergencyStop;
    }

    /**
     * @dev Withdraws trapped tokens in emergency situations
     * @param token Token address to withdraw
     */
    function emergencyWithdraw(address token) external onlyOwner {
        uint256 balance;
        if (token == address(0)) {
            balance = address(this).balance;
            (bool success, ) = owner.call{value: balance}("");
            require(success, "ETH transfer failed");
        } else {
            balance = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransfer(owner, balance);
        }
        
        emit EmergencyWithdrawal(token, balance, block.timestamp);
    }

    /**
     * @dev Updates contract parameters
     * @param _minProfitThreshold New minimum profit threshold
     * @param _maxGasPrice New maximum gas price
     */
    function updateParameters(
        uint256 _minProfitThreshold,
        uint256 _maxGasPrice
    ) external onlyOwner {
        minProfitThreshold = _minProfitThreshold;
        maxGasPrice = _maxGasPrice;
        
        emit ParametersUpdated(
            minProfitThreshold,
            maxGasPrice,
            block.timestamp
        );
    }

    /**
     * @dev Receive function to accept ETH payments
     */
    receive() external payable {}
}