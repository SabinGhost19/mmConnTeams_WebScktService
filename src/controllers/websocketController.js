export default (io, apiService) => {
  const activeUsers = new Map();
  const userChannels = new Map();

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.user.id}`);
    activeUsers.set(socket.user.id, socket);

    socket.on("test-message", (message) => {
      console.log("Test message received:", message);
      io.emit("test-response", {
        ...message,
        serverTimestamp: new Date().toISOString(),
        userId: socket.user.id,
      });
    });

    // Test STOMP endpoint
    socket.on("subscribe-to-test", (data) => {
      socket.join("test-room");
      socket.emit("test-subscribed", { success: true });
    });

    // Gestionare erori
    socket.on("error", (error) => {
      console.error(`Socket error for user ${socket.user.id}:`, error);
    });

    // Abonare la canale
    socket.on("subscribe", async ({ teamId, channelId }) => {
      try {
        if (!teamId || !channelId) {
          throw new Error("Team ID and Channel ID are required");
        }

        // Părăsește canalele anterioare
        const previousChannels = userChannels.get(socket.user.id) || [];
        previousChannels.forEach((ch) => socket.leave(ch));

        // Alătură-te noului canal
        const channelRoom = `team:${teamId}:channel:${channelId}`;
        socket.join(channelRoom);
        userChannels.set(socket.user.id, [channelRoom]);

        // Obține istoricul mesajelor
        const messages = await apiService.getChannelMessages(
          channelId,
          socket.handshake.auth.token
        );

        socket.emit("messages", messages);
        console.log(`User ${socket.user.id} subscribed to ${channelRoom}`);
      } catch (err) {
        console.error("Subscription error:", err);
        socket.emit("error", {
          code: "SUBSCRIBE_ERROR",
          message: err.message,
        });
      }
    });

    // Mesaj nou
    socket.on("message", async ({ teamId, channelId, content }) => {
      try {
        if (!teamId || !channelId || !content) {
          throw new Error("Missing required fields");
        }

        const messageData = {
          channelId,
          senderId: socket.user.id,
          content,
        };

        const savedMessage = await apiService.sendMessage(
          messageData,
          socket.handshake.auth.token
        );

        // Difuzează mesajul
        io.to(`team:${teamId}:channel:${channelId}`).emit(
          "message",
          savedMessage
        );
      } catch (err) {
        console.error("Message error:", err);
        socket.emit("error", {
          code: "MESSAGE_ERROR",
          message: err.message,
        });
      }
    });

    // Indicatori de tastare
    socket.on("typing", ({ teamId, channelId, isTyping }) => {
      try {
        if (!teamId || !channelId) {
          throw new Error("Missing team or channel ID");
        }

        socket.to(`team:${teamId}:channel:${channelId}`).emit("typing", {
          userId: socket.user.id,
          isTyping,
        });
      } catch (err) {
        console.error("Typing indicator error:", err);
      }
    });

    // Deconectare
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.user.id}`);
      activeUsers.delete(socket.user.id);
      userChannels.delete(socket.user.id);
    });
  });
};
