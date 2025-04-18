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

// create Socket.IO server
const io = new Server(server, {
  cors: corsOptions,
  path: "/ws",
});

// cache for active channels with connected users
const activeChannels = new Map();
// cache for channel messages to reduce API calls
const channelMessagesCache = new Map();

// use authentication middleware
io.use(authenticateSocket);

// socket connection handler
io.on("connection", async (socket) => {
  console.log(`User connected: ${socket.user.id} (${socket.user.name})`);

  // track user token for API calls
  const userToken = socket.handshake.auth.token;

  // join a channel
  socket.on("join-channel", async (data) => {
    try {
      const { channelId } = data;

      if (!channelId) {
        socket.emit("error", { message: "Channel ID is required" });
        return;
      }

      console.log(`User ${socket.user.id} joining channel ${channelId}`);

      // join socket room for this channel
      socket.join(`channel:${channelId}`);

      // track active users in the channel
      if (!activeChannels.has(channelId)) {
        activeChannels.set(channelId, new Set());
      }
      activeChannels.get(channelId).add(socket.user.id);

      // notify other users in the channel
      socket.to(`channel:${channelId}`).emit("user-joined", {
        channelId,
        user: {
          id: socket.user.id,
          name: socket.user.name,
        },
        timestamp: new Date().toISOString(),
      });

      // fetch channel messages and send to the user
      try {
        // try to get messages from cache first
        let messages;
        const cacheKey = `${channelId}`;

        if (channelMessagesCache.has(cacheKey)) {
          console.log(`Using cached messages for channel ${channelId}`);
          messages = channelMessagesCache.get(cacheKey);
        } else {
          // if not in cache, fetch from API
          console.log(`Fetching messages from API for channel ${channelId}`);
          messages = await getChannelMessages(channelId, userToken);

          // store in cache for future use (5 minutes expiry)
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

      // confirm subscription
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

  // leave a channel
  socket.on("leave-channel", (data) => {
    const { channelId } = data;

    if (channelId && activeChannels.has(channelId)) {
      // remove user from channel tracking
      activeChannels.get(channelId).delete(socket.user.id);

      // clean up empty channels
      if (activeChannels.get(channelId).size === 0) {
        activeChannels.delete(channelId);
      }

      // leave the socket room
      socket.leave(`channel:${channelId}`);

      // notify others
      socket.to(`channel:${channelId}`).emit("user-left", {
        channelId,
        userId: socket.user.id,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // new message event handler
  socket.on("new-message", async (messageData) => {
    try {
      const { channelId, content, attachments = [] } = messageData;

      if (!channelId || !content) {
        socket.emit("error", {
          message: "Channel ID and content are required",
        });
        return;
      }

      // create message object
      const newMessage = {
        channelId,
        content,
        attachments,
        createdAt: new Date().toISOString(),
      };

      // save to database via API
      try {
        const savedMessage = await createMessage(newMessage, userToken);

        // update cache if it exists
        const cacheKey = `${channelId}`;
        if (channelMessagesCache.has(cacheKey)) {
          const cachedMessages = channelMessagesCache.get(cacheKey);
          channelMessagesCache.set(cacheKey, [...cachedMessages, savedMessage]);
        }

        // broadcast to all users in channel
        io.to(`channel:${channelId}`).emit("message", savedMessage);

        // confirm to sender
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

  // handle file upload notifications
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

      // broadcast to all users in the channel about the new file
      io.to(`channel:${channelId}`).emit("file-uploaded", {
        channelId,
        fileData,
        uploadedBy: {
          id: socket.user.id,
          name: socket.user.name,
        },
        timestamp: new Date().toISOString(),
      });

      // update cache if needed - similar to message handling
      const cacheKey = `${channelId}`;
      if (channelMessagesCache.has(cacheKey)) {
        // if there's a message with this attachment, no need to update cache
        // the message handler will take care of that
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

  // message reaction handler
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

      // check if this message exists in cache
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

      // if reaction already exists, remove it
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

          // update cache if it exists
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

          // broadcast removal to channel
          io.to(`channel:${channelId}`).emit("reaction-update", {
            id: existingReaction.id,
            messageId,
            userId: socket.user.id,
            channelId,
            reactionType,
            action: "remove",
          });

          return; // rxit early after removing
        } catch (error) {
          console.error("Error removing existing reaction:", error);
        }
      }

      // if no existing reaction or removal failed, add new reaction
      try {
        const savedReaction = await addReaction(messageId, reaction, userToken);

        // pdate cache if it exists
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

        // create a full reaction object to broadcast
        const reactionData = {
          id: savedReaction.id,
          messageId,
          userId: socket.user.id,
          channelId,
          reactionType,
          action: "add",
        };
        console.log("REACTION DATA: " + reactionData);

        // broadcast to channel
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

  // rmv reaction handler
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

      // rmv from database via API
      try {
        await removeReaction(
          messageId,
          reactionId,
          socket.user.id,
          reactionType,
          userToken
        );

        // update cache if it exists
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

        // broadcast to channel
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
  // force refresh channel messages
  socket.on("refresh-messages", async (data) => {
    try {
      const { channelId } = data;

      if (!channelId) {
        socket.emit("error", { message: "Channel ID is required" });
        return;
      }

      // clear cache for this channel
      const cacheKey = `${channelId}`;
      channelMessagesCache.delete(cacheKey);

      // fetch fresh messages
      const messages = await getChannelMessages(channelId, userToken);

      // update cache
      channelMessagesCache.set(cacheKey, messages);

      // send to user
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

  // handle typing indicators
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

  // handle legacy test channel for backward compatibility
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

  // disconnect handler
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.user.id}`);

    // clean up user from all active channels
    for (const [channelId, users] of activeChannels.entries()) {
      if (users.has(socket.user.id)) {
        users.delete(socket.user.id);

        // notify channel users
        socket.to(`channel:${channelId}`).emit("user-left", {
          channelId,
          userId: socket.user.id,
          timestamp: new Date().toISOString(),
        });

        // remove empty channels
        if (users.size === 0) {
          activeChannels.delete(channelId);
        }
      }
    }
  });
});

// health check route
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    websocket: io.engine.clientsCount > 0 ? "active" : "inactive",
    clients: io.engine.clientsCount,
    activeChannels: Array.from(activeChannels.keys()).length,
    cachedChannels: Array.from(channelMessagesCache.keys()).length,
  });
});

// start server
const PORT = process.env.PORT || 8082;
server.listen(PORT, () => {
  console.log(`
  Server running on port ${PORT}
  WebSocket endpoint: ws://localhost:${PORT}/ws
  Health check: http://localhost:${PORT}/health
  `);
});
