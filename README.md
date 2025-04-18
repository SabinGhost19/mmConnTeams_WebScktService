# WebSocket Service for Teams Application

This is the **WebSocket Service** for the Teams application. It provides real-time communication features such as messaging, typing indicators, file upload notifications, and reactions. The service is built using **Node.js**, **Express**, and **Socket.IO**.

## Features

- Real-time messaging between users in channels.
- Typing indicators to show when a user is typing.
- File upload notifications in channels.
- Reactions to messages (add/remove).
- Caching for channel messages to reduce API calls.
- Integration with the main application for authentication and data persistence.

## How It Fits into the Larger Application

This service is part of a larger application that includes:

- A **frontend** built with Next.js for the user interface.
- A **backend API** (Spring Boot) for data persistence and business logic.

The WebSocket service connects to the backend API for fetching and saving data and communicates with the frontend via WebSocket connections.

## Installation and Setup

### Prerequisites

- Node.js (v16 or higher)
- npm (Node Package Manager)
- Docker (optional, for containerized deployment)

### Steps to Install and Run

1. **Clone the Repository**

   ```bash
   git clone <repository-url>
   cd _WebSocketConn_service/server-express-ws
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Set Up Environment Variables**
   Create a `.env` file in the root of the project with the following content:

   ```env
   PORT=8082
   FRONTEND_URL=http://localhost:3000
   SPRING_BOOT_URL=http://localhost:8081/api
   JWT_SECRET=your_jwt_secret_here
   ```

4. **Run the Service**

   - For development:
     ```bash
     npm run dev
     ```
   - For production:
     ```bash
     npm start
     ```

5. **Access the Service**
   - WebSocket endpoint: `ws://localhost:8082/ws`
   - Health check: [`http://localhost:8082/health`](http://localhost:8082/health)

### Docker Deployment

1. **Build the Docker Image**

   ```bash
   docker build -t websocket-service .
   ```

2. **Run the Docker Container**
   ```bash
   docker run -p 8082:8082 --env-file .env websocket-service
   ```

## Project Structure

```
server-express-ws/
├── src/
│   ├── app.js               # Main application entry point
│   ├── config/              # Configuration files (if needed)
│   ├── controllers/         # WebSocket event handlers
│   │   └── websocketController.js
│   ├── middleware/          # Middleware for authentication
│   │   └── authMiddleware.js
│   ├── services/            # Services for API calls
│   │   ├── authService.js   # Handles authentication
│   │   ├── messageService.js # Handles message-related API calls
│   ├── utils/               # Utility functions (if needed)
├── .env                     # Environment variables
├── .gitignore               # Ignored files and directories
├── Dockerfile               # Docker configuration
├── package.json             # Project metadata and dependencies
└── README.md                # Documentation
```

### Directory Roles

- **`src/app.js`**: Main entry point for the WebSocket server.
- **`src/controllers/`**: Contains WebSocket event handlers (e.g., messaging, typing indicators).
- **`src/middleware/`**: Middleware for authenticating WebSocket connections.
- **`src/services/`**: Handles API calls to the backend (e.g., saving messages, fetching channel data).
- **`src/utils/`**: Utility functions for common tasks.
- **`.env`**: Configuration for environment variables.
- **`Dockerfile`**: Configuration for building and running the service in a Docker container.

## API Integration

- **Frontend**: Communicates with this service via WebSocket for real-time updates.
- **Backend API**: Provides data persistence and business logic. This service interacts with the backend API for fetching and saving data.

## Example Usage

1. **Join a Channel**

   - Event: `join-channel`
   - Payload: `{ channelId: "123" }`

2. **Send a Message**

   - Event: `new-message`
   - Payload: `{ channelId: "123", content: "Hello, world!" }`

3. **Add a Reaction**

   - Event: `add-reaction`
   - Payload: `{ messageId: "456", channelId: "123", reactionType: "like" }`

4. **Typing Indicator**
   - Event: `typing`
   - Payload: `{ channelId: "123", isTyping: true }`

## Health Check

You can verify the service is running by accessing the health check endpoint:

```bash
http://localhost:8082/health
```
