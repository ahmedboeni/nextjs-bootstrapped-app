```markdown
# Detailed Workflow System Implementation Plan

This plan details changes across backend modules, API endpoints, and UI components to address security, error handling, and operational efficiency for the intelligent customer service workflow.

---

## 1. New Library Modules and Utility Functions

### a. Message Broker Integration (src/lib/messageBroker.ts)
- **Purpose:** Abstract interaction with Kafka/RabbitMQ.
- **Changes:**
  - Implement classes/functions to publish and consume messages.
  - Add error handling with retries and a dead-letter queue (using an in-memory queue or external service).
  - Document integration points for each messaging channel.

### b. Webhook & Request Validation (src/lib/validation.ts)
- **Purpose:** Secure incoming requests.
- **Changes:**
  - Create `verifyWebhookSignature(message, signature)` using HMAC with a dummy secret.
  - Validate messages from WhatsApp, Telegram, etc.
  - Log and reject unverified requests.

### c. Rate Limiting Middleware (src/lib/rateLimiter.ts)
- **Purpose:** Protect endpoints against abuse.
- **Changes:**
  - Implement a middleware function to track request counts per channel (in-memory store).
  - Return HTTP 429 if limits are exceeded.
  - Integrate with API endpoints for message reception.

### d. Encryption Utility (src/lib/encryption.ts)
- **Purpose:** Encrypt/decrypt sensitive attachments.
- **Changes:**
  - Use Node.js native crypto (AES-256).
  - Create functions: `encryptData(data: Buffer, key: string)` and `decryptData(encrypted: Buffer, key: string)`.
  - Integrate with logging endpoints for attachment processing.

### e. Idempotency Manager (src/lib/idempotency.ts)
- **Purpose:** Prevent duplicate actions during execution.
- **Changes:**
  - Implement functions `checkIdempotency(actionId: string)` and `storeAction(actionId: string)`.
  - For prototyping, use an in-memory Map (note: replace with Redis for production).

### f. LLM Interface (src/lib/llm.ts)
- **Purpose:** Abstract calls to the LLM provider.
- **Changes:**
  - Create function `callLLM(prompt: string, options?: any)` that calls the OpenRouter endpoint (`https://openrouter.ai/api/v1/chat/completions`) using dummy API keys.
  - Enforce `max_tokens=500` for cost control and add error handling for API failures.

### g. Learning Loop Enhancements (src/lib/learningLoop.ts)
- **Purpose:** Validate and filter training data.
- **Changes:**
  - Implement `validateHumanResponse(customerId, aiResponse, humanResponse)` based on the provided pseudocode.
  - Use a semantic difference function (mock or cosine similarity) to trigger human review if the difference exceeds a threshold.
  
### h. Data Cleanup & Retention (src/lib/cleanup.ts)
- **Purpose:** Enforce data retention policies.
- **Changes:**
  - Implement `cleanupExpiredData()` to remove records older than a set period (e.g., 365 days).
  - Schedule a daily run using node-cron with robust error handling.

---

## 2. API Endpoints (Next.js Route Handlers)

### a. Receive Message Endpoint (src/app/api/receive/route.ts)
- **Functionality:**
  - Accept POST requests from messaging channels.
  - Validate incoming requests with `verifyWebhookSignature`.
  - Enforce rate limiting via the middleware in `rateLimiter.ts`.
  - Forward valid messages to the message broker.

### b. Raw Message Logging (src/app/api/log/route.ts)
- **Functionality:**
  - Store raw messages in a simulated Data Lake (e.g., log to a file or database).
  - Append a `retention_expiry` field and encrypt attachments prior to persisting.

### c. Message Processing (src/app/api/process/route.ts)
- **Functionality:**
  - Process messages by calling the LLM interface (from `llm.ts`) and running NLP pipelines.
  - Store analysis results (sentiment, intent, context) in dedicated logs/tables.
  
### d. Action Execution (src/app/api/execute/route.ts)
- **Functionality:**
  - Execute decisions through ERP/RPA integrations.
  - Use idempotency checks to avoid duplicate actions.
  - Implement a retry mechanism with exponential backoff for failures.
  
### e. Outbound Messaging (src/app/api/send/route.ts)
- **Functionality:**
  - Send responses to users using channel-specific formatting (e.g., rich text for email, buttons simulation for WhatsApp).
  - Use asynchronous methods to confirm message delivery and log errors.

---

## 3. UI and Monitoring

### a. Monitoring Dashboard (src/app/monitoring/page.tsx)
- **Features:**
  - A modern, stylistic admin page displaying workflow statistics (incoming message volume, processing status, estimated LLM cost).
  - Use clean typography, ample white space, and simple layout grids.
  - In case of image use, apply placeholders via `<img src="https://placehold.co/1920x1080?text=Modern+dashboard+display+for+workflow+monitoring" alt="Detailed view of a modern dashboard with metrics and workflow status" onerror="this.style.display='none'" />`.

---

## 4. Enhancements to Existing Files

### a. Utils Update (src/lib/utils.ts)
- **Changes:**
  - Add helper functions that call encryption, idempotency, and logging modules.
  
### b. Documentation and Testing
- **README.md:** Update to include details about new endpoints, environment variables (dummy API keys), and deployment instructions.
- **tests/api_test.sh:** Create a script with curl commands for each endpoint to simulate real-world API testing scenarios (including JSON responses and binary checks).

### c. Package Configuration Updates (package.json, tsconfig.json)
- **Dependencies:** Add node-cron, axios, and optionally redis.
- **ESLint:** Update configuration in eslint.config.mjs to follow new code patterns.

---

## 5. AI Features Integration

- **LLM Provider:** Use OpenRouter with model `anthropic/claude-sonnet-4` via the endpoint `https://openrouter.ai/api/v1/chat/completions`. Dummy API keys will be inserted.
- **Behavior:** Enforce prompt engineering guidelines, cost monitoring (max_tokens=500), and human-in-the-loop via the learning loop module.
- **Outcome:** Ensure responses maintain company tone and trigger review if responses deviate significantly.

---

## 6. Error Handling & Best Practices

- Implement try-catch blocks in all API endpoints.
- Log errors with appropriate severity and return HTTP error codes.
- Use middleware for repetitive tasks like webhook validation and rate limiting.
- Structure directories into clear modules (Input Layer, AI/Processing, Execution, Logging) for maintainability.

---

# Summary

- New modules (validation, rateLimiter, encryption, idempotency, llm, learningLoop, cleanup) ensure secure, efficient processing.
- Five API endpoints (receive, log, process, execute, send) integrate messaging channels with proper error handling and idempotency.
- A modern monitoring dashboard (src/app/monitoring/page.tsx) enables tracking real-time performance.
- LLM integration via OpenRouter (dummy keys; model: anthropic/claude-sonnet-4) enforces cost and prompt control.
- Enhanced utilities and documentation update improve maintainability and clarity.
- Robust error handling, webhook validation, and rate limiting secure the system.
- A testing script (tests/api_test.sh) validates API responses via curl.
- The plan separates concerns into clear modules for future scalability.
