# Browser Automation Container

A headless browser automation service that runs in a Docker container. This Node.js application provides a REST API to control browser actions and extract DOM information.

## Overview

This system establishes a dedicated Docker container that runs a Node.js application with Puppeteer to control a headless Chrome browser. Instead of relying on screenshots for navigation, the system extracts DOM elements and can communicate them to an external agent. The agent can then return a list of desired element interactions and corresponding actions, which the Node.js app executes.

## Features

- **Session-based Browser Automation**: Maintain browser sessions across multiple API calls
- **DOM Extraction**: Extract complete DOM information rather than just screenshots
- **Unified Actions API**: Single endpoint for executing multiple sequential browser actions
- **Screenshot Capabilities**: Take screenshots of entire pages or specific elements
- **Docker Containerization**: Runs in a headless environment with no GUI dependencies

## Architecture

- **Docker Container**: Runs a Node.js application with Puppeteer
- **Express Server**: Provides REST endpoints for controlling browser actions
- **Puppeteer Integration**: Controls headless Chrome browser
- **Session Management**: Maintains browser sessions for continuous interaction

## Installation

### Prerequisites

- Docker
- Docker Compose

### Setup

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd browser-automation-container
   ```

2. Build and start the container:
   ```bash
   docker-compose up -d
   ```

3. The service will be available at `http://localhost:3010`

## API Reference

### Actions Endpoint

**POST /actions**

Execute a sequence of browser actions.

```json
{
  "sessionId": "optional-session-id",
  "actions": [
    { "type": "navigate", "url": "https://example.com" },
    { "type": "click", "selector": "#someButton" },
    { "type": "type", "selector": "input[name='search']", "value": "search term" },
    { "type": "press", "key": "Enter" },
    { "type": "wait", "milliseconds": 2000 },
    { "type": "screenshot" },
    { "type": "close" }
  ]
}
```

#### Available Action Types

| Action Type | Description | Required Parameters |
|-------------|-------------|---------------------|
| `navigate` | Navigate to a URL | `url`: The URL to navigate to |
| `click` | Click an element | `selector`: CSS selector of element to click |
| `type` | Enter text into a field | `selector`: Element to type in, `value`: Text to type |
| `keys` | Type keyboard input | `keys`: Text to type |
| `press` | Press a specific key | `key`: Key to press (e.g., "Enter", "Tab") |
| `select` | Select dropdown option | `selector`: Dropdown element, `value`: Option value |
| `wait` | Wait for a specified time | `milliseconds`: Time to wait |
| `screenshot` | Take a screenshot | `selector` (optional): Element to screenshot |
| `close` | Close the current session | None |

#### Response

```json
{
  "success": true,
  "sessionId": "session-id",
  "url": "current-url",
  "title": "page-title",
  "actions": [
    { "success": true, "type": "navigate", "url": "https://example.com" },
    { "success": true, "type": "click", "selector": "#someButton" }
  ],
  "elements": [
    {
      "tag": "div",
      "selector": "body > div:nth-child(1)",
      "attributes": { "class": "container" },
      "textContent": "Example text",
      "isInteractive": false
    }
  ],
  "screenshot": "data:image/png;base64,..."
}
```

### Screenshot Endpoint

**POST /screenshot**

Take a screenshot of the current page in a session.

```json
{
  "sessionId": "your-session-id",
  "selector": "#optional-element-selector"
}
```

### Session Management

**GET /sessions**

List all active browser sessions.

**DELETE /sessions/:sessionId**

Close a specific browser session.

**GET /health**

Check the health of the service.

## Example Usage

Here's a simple example using fetch in Node.js:

```javascript
const fetch = require('node-fetch');

async function automateWebsite() {
  const response = await fetch('http://localhost:3000/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actions: [
        { type: 'navigate', url: 'https://example.com' },
        { type: 'click', selector: 'a' },
        { type: 'wait', milliseconds: 2000 },
        { type: 'screenshot' }
      ]
    })
  });
  
  const data = await response.json();
  console.log(`Page title: ${data.title}`);
  console.log(`Found ${data.elements.length} DOM elements`);
}

automateWebsite();
```

## Integration with External Agents

This system is designed to work with external AI agents or other automation systems:

1. The agent can request navigation to a URL
2. Our system returns the extracted DOM elements
3. The agent analyzes the DOM and determines actions to take
4. Our system executes those actions and returns updated DOM information
5. This cycle continues until the task is complete

## Security Considerations

- The container runs with minimal privileges
- Consider network isolation for production deployments
- Be aware of website Terms of Service when automating interactions
- Implement rate limiting for public-facing deployments
