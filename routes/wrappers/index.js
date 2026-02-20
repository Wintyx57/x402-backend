// routes/wrappers/index.js — Combined wrappers router
// Imports all sub-modules and mounts them on a single router

const express = require('express');
const createWebRouter = require('./web');
const createDataRouter = require('./data');
const createTextRouter = require('./text');
const createValidationRouter = require('./validation');
const createToolsRouter = require('./tools');
const createAiRouter = require('./ai');
const createMiscRouter = require('./misc');
const createIntelligenceRouter = require('./intelligence');

function createWrappersRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // Mount all sub-routers
    router.use(createWebRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));
    router.use(createDataRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));
    router.use(createTextRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));
    router.use(createValidationRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));
    router.use(createToolsRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));
    router.use(createAiRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));
    router.use(createMiscRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));
    router.use(createIntelligenceRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));

    return router;
}

module.exports = createWrappersRouter;
