import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { authenticateSocket } from "./services/authService.js";
import {
  getChannelMessages,
  addReaction,
  removeReaction,
  createMessage,
} from "./services/messageService.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Create Socket.IO server
const io = new Server(server, {
  cors: corsOptions,
  path: "/ws",
});

// Cache for active channels with connected users
const activeChannels = new Map();
// Cache for channel messages to reduce API calls
const channelMessagesCache = new Map();

// Use authentication middleware
io.use(authenticateSocket);

// Socket connection handler
io.on("connection", async (socket) => {
  console.log(`User connected: ${socket.user.id} (${socket.user.name})`);

  // Track user token for API calls
  const userToken = socket.handshake.auth.token;

  // Join a channel
  socket.on("join-channel", async (data) => {
    try {
      const { channelId } = data;

      if (!channelId) {
        socket.emit("error", { message: "Channel ID is required" });
        return;
      }

      console.log(`User ${socket.user.id} joining channel ${channelId}`);

      // Join socket room for this channel
      socket.join(`channel:${channelId}`);

      // Track active users in the channel
      if (!activeChannels.has(channelId)) {
        activeChannels.set(channelId, new Set());
      }
      activeChannels.get(channelId).add(socket.user.id);

      // Notify other users in the channel
      socket.to(`channel:${channelId}`).emit("user-joined", {
        channelId,
        user: {
          id: socket.user.id,
          name: socket.user.name,
        },
        timestamp: new Date().toISOString(),
      });

      // Fetch channel messages and send to the user
      try {
        // Try to get messages from cache first
        let messages;
        const cacheKey = `${channelId}`;

        if (channelMessagesCache.has(cacheKey)) {
          console.log(`Using cached messages for channel ${channelId}`);
          messages = channelMessagesCache.get(cacheKey);
        } else {
          // If not in cache, fetch from API
          console.log(`Fetching messages from API for channel ${channelId}`);
          messages = await getChannelMessages(channelId, userToken);

          // Store in cache for future use (5 minutes expiry)
          channelMessagesCache.set(cacheKey, messages);
          setTimeout(() => {
            channelMessagesCache.delete(cacheKey);
          }, 5 * 60 * 1000);
        }

        console.log(
          `Sending ${messages.length} messages to user for channel ${channelId}`
        );
        socket.emit("channel-history", { channelId, messages });
      } catch (error) {
        console.error(
          `Failed to fetch messages for channel ${channelId}:`,
          error
        );
        socket.emit("error", {
          type: "FETCH_MESSAGES_ERROR",
          message: "Failed to fetch channel messages",
        });
      }

      // Confirm subscription
      socket.emit("channel-joined", {
        channelId,
        timestamp: new Date().toISOString(),
        activeUsers: Array.from(activeChannels.get(channelId)),
      });
    } catch (error) {
      console.error("Error joining channel:", error);
      socket.emit("error", { message: "Failed to join channel" });
    }
  });

  // Leave a channel
  socket.on("leave-channel", (data) => {
    const { channelId } = data;

    if (channelId && activeChannels.has(channelId)) {
      // Remove user from channel tracking
      activeChannels.get(channelId).delete(socket.user.id);

      // Clean up empty channels
      if (activeChannels.get(channelId).size === 0) {
        activeChannels.delete(channelId);
      }

      // Leave the socket room
      socket.leave(`channel:${channelId}`);

      // Notify others
      socket.to(`channel:${channelId}`).emit("user-left", {
        channelId,
        userId: socket.user.id,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // New message event handler
  socket.on("new-message", async (messageData) => {
    try {
      const { channelId, content, attachments = [] } = messageData;

      if (!channelId || !content) {
        socket.emit("error", {
          message: "Channel ID and content are required",
        });
        return;
      }

      // Create message object
      const newMessage = {
        channelId,
        content,
        attachments,
        createdAt: new Date().toISOString(),
      };

      // Save to database via API
      try {
        const savedMessage = await createMessage(newMessage, userToken);

        // Update cache if it exists
        const cacheKey = `${channelId}`;
        if (channelMessagesCache.has(cacheKey)) {
          const cachedMessages = channelMessagesCache.get(cacheKey);
          channelMessagesCache.set(cacheKey, [...cachedMessages, savedMessage]);
        }

        // Broadcast to all users in channel
        io.to(`channel:${channelId}`).emit("message", savedMessage);

        // Confirm to sender
        socket.emit("message-sent", {
          messageId: savedMessage.id,
          status: "delivered",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Error saving message:", error);
        socket.emit("error", {
          type: "SAVE_MESSAGE_ERROR",
          message: "Failed to save message",
        });
      }
    } catch (error) {
      console.error("Error processing new message:", error);
      socket.emit("error", { message: "Failed to process message" });
    }
  });

  // Handle file upload notifications
  socket.on("file-upload-complete", async (data) => {
    try {
      const { channelId, fileData } = data;

      if (!channelId || !fileData) {
        socket.emit("error", {
          message: "Channel ID and file data are required",
        });
        return;
      }

      console.log(
        `User ${socket.user.id} uploaded file ${fileData.fileName} to channel ${channelId}`
      );

      // Broadcast to all users in the channel about the new file
      io.to(`channel:${channelId}`).emit("file-uploaded", {
        channelId,
        fileData,
        uploadedBy: {
          id: socket.user.id,
          name: socket.user.name,
        },
        timestamp: new Date().toISOString(),
      });

      // Update cache if needed - similar to message handling
      const cacheKey = `${channelId}`;
      if (channelMessagesCache.has(cacheKey)) {
        // If there's a message with this attachment, no need to update cache
        // The message handler will take care of that
        console.log(
          `Cache exists for channel ${channelId}, will be updated by message handler`
        );
      }
    } catch (error) {
      console.error("Error handling file upload notification:", error);
      socket.emit("error", {
        message: "Failed to process file upload notification",
      });
    }
  });

  // Message reaction handler
  socket.on("add-reaction", async (data) => {
    try {
      const { messageId, channelId, reactionType } = data;

      if (!messageId || !channelId || !reactionType) {
        socket.emit("error", {
          message: "Message ID, Channel ID and reaction type are required",
        });
        return;
      }

      const reaction = {
        userId: socket.user.id,
        reactionType,
      };

      console.log("INFOS TO BE SEND:...");
      console.log("Mid: " + messageId);
      console.log("Chid: " + channelId);
      console.log("ReactionType: " + reactionType);

      // Check if this message exists in cache
      const cacheKey = `${channelId}`;
      let existingReaction = null;

      if (channelMessagesCache.has(cacheKey)) {
        const cachedMessages = channelMessagesCache.get(cacheKey);
        const message = cachedMessages.find((msg) => msg.id === messageId);

        if (message && message.reactions) {
          existingReaction = message.reactions.find(
            (r) =>
              r.userId === socket.user.id && r.reactionType === reactionType
          );
        }
      }

      // If reaction already exists, remove it (toggle behavior)
      if (existingReaction) {
        console.log(
          `Found existing reaction, removing it: ${existingReaction.id}`
        );

        try {
          await removeReaction(
            messageId,
            existingReaction.id,
            socket.user.id,
            reactionType,
            userToken
          );

          // Update cache if it exists
          if (channelMessagesCache.has(cacheKey)) {
            const cachedMessages = channelMessagesCache.get(cacheKey);
            const updatedMessages = cachedMessages.map((msg) => {
              if (msg.id === messageId) {
                return {
                  ...msg,
                  reactions: (msg.reactions || []).filter(
                    (r) => r.id !== existingReaction.id
                  ),
                };
              }
              return msg;
            });
            channelMessagesCache.set(cacheKey, updatedMessages);
          }

          // Broadcast removal to channel
          io.to(`channel:${channelId}`).emit("reaction-update", {
            id: existingReaction.id,
            messageId,
            userId: socket.user.id,
            channelId,
            reactionType,
            action: "remove",
          });

          return; // Exit early after removing
        } catch (error) {
          console.error("Error removing existing reaction:", error);
        }
      }

      // If no existing reaction or removal failed, add new reaction
      try {
        const savedReaction = await addReaction(messageId, reaction, userToken);

        // Update cache if it exists
        if (channelMessagesCache.has(cacheKey)) {
          const cachedMessages = channelMessagesCache.get(cacheKey);
          const updatedMessages = cachedMessages.map((msg) => {
            if (msg.id === messageId) {
              return {
                ...msg,
                reactions: [...(msg.reactions || []), savedReaction],
              };
            }
            return msg;
          });
          channelMessagesCache.set(cacheKey, updatedMessages);
        }

        // Create a full reaction object to broadcast
        const reactionData = {
          id: savedReaction.id,
          messageId,
          userId: socket.user.id,
          channelId,
          reactionType,
          action: "add",
        };
        console.log("REACTION DATA: " + reactionData);

        // Broadcast to channel
        io.to(`channel:${channelId}`).emit("reaction-update", reactionData);
      } catch (error) {
        console.error("Error adding reaction:", error);
        socket.emit("error", {
          type: "REACTION_ERROR",
          message: "Failed to add reaction",
        });
      }
    } catch (error) {
      console.error("Error processing reaction:", error);
      socket.emit("error", { message: "Failed to process reaction" });
    }
  });

  // Remove reaction handler
  socket.on("remove-reaction", async (data) => {
    try {
      const { messageId, reactionId, channelId, reactionType } = data;

      if (!messageId || !reactionId || !channelId || !reactionType) {
        socket.emit("error", {
          message:
            "Message ID, Reaction ID, Channel ID and reaction type are required",
        });
        return;
      }

      // Remove from database via API
      try {
        await removeReaction(
          messageId,
          reactionId,
          socket.user.id,
          reactionType,
          userToken
        );

        // Update cache if it exists
        const cacheKey = `${channelId}`;
        if (channelMessagesCache.has(cacheKey)) {
          const cachedMessages = channelMessagesCache.get(cacheKey);
          const updatedMessages = cachedMessages.map((msg) => {
            if (msg.id === messageId) {
              return {
                ...msg,
                reactions: (msg.reactions || []).filter(
                  (r) => r.id !== reactionId
                ),
              };
            }
            return msg;
          });
          channelMessagesCache.set(cacheKey, updatedMessages);
        }

        // Broadcast to channel
        io.to(`channel:${channelId}`).emit("reaction-update", {
          id: reactionId,
          messageId,
          userId: socket.user.id,
          channelId,
          reactionType,
          action: "remove",
        });
      } catch (error) {
        console.error("Error removing reaction:", error);
        socket.emit("error", {
          type: "REACTION_ERROR",
          message: "Failed to remove reaction",
        });
      }
    } catch (error) {
      console.error("Error processing reaction removal:", error);
      socket.emit("error", { message: "Failed to process reaction removal" });
    }
  });
  // Force refresh channel messages
  socket.on("refresh-messages", async (data) => {
    try {
      const { channelId } = data;

      if (!channelId) {
        socket.emit("error", { message: "Channel ID is required" });
        return;
      }

      // Clear cache for this channel
      const cacheKey = `${channelId}`;
      channelMessagesCache.delete(cacheKey);

      // Fetch fresh messages
      const messages = await getChannelMessages(channelId, userToken);

      // Update cache
      channelMessagesCache.set(cacheKey, messages);

      // Send to user
      socket.emit("channel-history", { channelId, messages });
    } catch (error) {
      console.error(
        `Error refreshing messages for channel ${data.channelId}:`,
        error
      );
      socket.emit("error", {
        type: "FETCH_MESSAGES_ERROR",
        message: "Failed to refresh channel messages",
      });
    }
  });

  // Handle typing indicators
  socket.on("typing", (data) => {
    const { channelId, isTyping } = data;

    if (channelId) {
      socket.to(`channel:${channelId}`).emit("user-typing", {
        channelId,
        userId: socket.user.id,
        userName: socket.user.name,
        isTyping,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Handle legacy test channel for backward compatibility
  socket.on("subscribe-to-test", (data) => {
    socket.join("test-room");
    socket.emit("subscription-confirmed", {
      room: "test-room",
      userId: socket.user.id,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("test-message", (message) => {
    console.log("Test message received:", message);

    io.emit("test-response", {
      ...message,
      serverTimestamp: new Date().toISOString(),
      userId: socket.user.id,
    });

    socket.emit("test-private-response", {
      ...message,
      serverTimestamp: new Date().toISOString(),
      status: "acknowledged",
    });
  });

  // Disconnect handler
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.user.id}`);

    // Clean up user from all active channels
    for (const [channelId, users] of activeChannels.entries()) {
      if (users.has(socket.user.id)) {
        users.delete(socket.user.id);

        // Notify channel users
        socket.to(`channel:${channelId}`).emit("user-left", {
          channelId,
          userId: socket.user.id,
          timestamp: new Date().toISOString(),
        });

        // Remove empty channels
        if (users.size === 0) {
          activeChannels.delete(channelId);
        }
      }
    }
  });
});

// Health check route
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    websocket: io.engine.clientsCount > 0 ? "active" : "inactive",
    clients: io.engine.clientsCount,
    activeChannels: Array.from(activeChannels.keys()).length,
    cachedChannels: Array.from(channelMessagesCache.keys()).length,
  });
});

// Start server
const PORT = process.env.PORT || 8082;
server.listen(PORT, () => {
  console.log(`
  Server running on port ${PORT}
  WebSocket endpoint: ws://localhost:${PORT}/ws
  Health check: http://localhost:${PORT}/health
  `);
});
