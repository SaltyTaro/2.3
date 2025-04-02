const ethers = require('ethers');
const config = require('../config');
const { logger } = require('./logger');

// In-memory cache for providers
let provider = null;
let wsProvider = null;
let tokenManager = null;
let abiDecoder = null;

/**
 * Get Ethereum providers
 * @returns {Object} HTTP and WebSocket providers
 */
function getProviders() {
  if (!provider || !wsProvider) {
    // Initialize providers
    initializeProviders();
  }
  
  return { provider, wsProvider };
}

/**
 * Initialize providers with fallback support
 */
function initializeProviders() {
  try {
    // Initialize WebSocket provider
    initializeWebSocketProvider();
    
    // Initialize HTTP provider
    initializeHttpProvider();
    
    logger.info('Providers initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize providers', error);
    throw new Error('Failed to initialize providers');
  }
}

/**
 * Initialize WebSocket provider with fallback support
 */
function initializeWebSocketProvider() {
  // Try to connect to each WebSocket endpoint
  for (const wsEndpoint of config.WS_ENDPOINTS) {
    try {
      wsProvider = new ethers.providers.WebSocketProvider(wsEndpoint);
      
      // Add event listeners for WebSocket connection
      wsProvider._websocket.on('open', () => {
        logger.info(`WebSocket connection established to ${wsEndpoint}`);
      });
      
      wsProvider._websocket.on('error', (error) => {
        logger.error(`WebSocket error with ${wsEndpoint}`, error);
      });
      
      wsProvider._websocket.on('close', () => {
        logger.warn(`WebSocket connection to ${wsEndpoint} closed. Reconnecting...`);
        setTimeout(() => {
          initializeWebSocketProvider();
        }, 5000);
      });
      
      logger.info(`Using WebSocket provider: ${wsEndpoint}`);
      
      // If we get here, the connection was successful
      break;
    } catch (error) {
      logger.warn(`Failed to connect to WebSocket endpoint: ${wsEndpoint}`, error);
      // Continue to next endpoint
    }
  }
  
  if (!wsProvider) {
    logger.error('Failed to connect to any WebSocket provider');
    throw new Error('Failed to connect to any WebSocket provider');
  }
}

/**
 * Initialize HTTP provider with fallback support
 */
function initializeHttpProvider() {
  // Create providers array for fallback
  const providers = [];
  
  for (const httpEndpoint of config.HTTP_ENDPOINTS) {
    try {
      providers.push(new ethers.providers.JsonRpcProvider(httpEndpoint));
    } catch (error) {
      logger.warn(`Failed to connect to HTTP endpoint: ${httpEndpoint}`, error);
      // Continue to next endpoint
    }
  }
  
  if (providers.length === 0) {
    logger.error('Failed to connect to any HTTP provider');
    throw new Error('Failed to connect to any HTTP provider');
  }
  
  // Create fallback provider if we have multiple endpoints
  if (providers.length > 1) {
    provider = new ethers.providers.FallbackProvider(
      providers.map((p, i) => ({ provider: p, priority: i, stallTimeout: 2000 })),
      1 // Only need 1 provider to respond
    );
    logger.info(`Using fallback provider with ${providers.length} endpoints`);
  } else {
    // Just use the first provider if only one
    provider = providers[0];
    logger.info(`Using single HTTP provider: ${config.HTTP_ENDPOINTS[0]}`);
  }
}

/**
 * Get token manager instance
 * @param {Provider} provider Ethereum provider
 * @returns {TokenManager} Token manager instance
 */
function getTokenManager(provider) {
  if (!tokenManager) {
    const TokenManager = require('./TokenManager');
    tokenManager = new TokenManager(provider);
    logger.info('TokenManager initialized');
  }
  
  return tokenManager;
}

/**
 * Get ABI decoder instance
 * @returns {Object} ABI decoder
 */
function getAbiDecoder() {
  if (!abiDecoder) {
    const abiDecoderModule = require('abi-decoder');
    
    // Add ABIs for commonly used contracts
    for (const dex of config.SUPPORTED_DEXES) {
      abiDecoderModule.addABI(dex.abi);
    }
    
    abiDecoder = abiDecoderModule;
    logger.info('ABI decoder initialized');
  }
  
  return abiDecoder;
}

module.exports = {
  getProviders,
  getTokenManager,
  getAbiDecoder
};