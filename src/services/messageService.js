import fetch from "node-fetch";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const API_SERVICE_URL = process.env.API_SERVICE_URL || "http://localhost:8080";

/**
 * Fetches messages for a specific channel
 *
 * @param {string} channelId - The UUID of the channel
 * @param {string} token - JWT token for authentication
 * @returns {Promise<Array>} Array of messages
 */
export async function getChannelMessages(channelId, token) {
  try {
    console.log(`Fetching messages for channel ${channelId}`);

    const response = await fetch(
      `${API_SERVICE_URL}/api/channels/${channelId}/messages`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch messages: ${response.status}`);
    }

    const messages = await response.json();
    console.log(
      `Retrieved ${messages.length} messages for channel ${channelId}`
    );
    return messages;
  } catch (error) {
    console.error(`Error fetching messages for channel ${channelId}:`, error);
    throw error;
  }
}

export async function addReaction(messageId, reaction, token) {
  try {
    // Formatul cerut de backend-ul Spring Boot
    const payload = {
      user_id: reaction.userId,
      reaction_type: reaction.reactionType,
    };
    console.log(
      "Pyalod to be send " + payload.user_id + " and " + payload.reaction_type
    );

    const response = await fetch(
      `${API_SERVICE_URL}/api/messages/${messageId}/reactions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to add reaction: ${response.status}`);
    }

    // Pentru a obține ID-ul reacției create
    const reactionsResponse = await fetch(
      `${API_SERVICE_URL}/api/messages/${messageId}/reactions`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!reactionsResponse.ok) {
      throw new Error(`Failed to fetch reactions: ${reactionsResponse.status}`);
    }

    const reactions = await reactionsResponse.json();
    const createdReaction = reactions.find(
      (r) =>
        r.userId === reaction.userId && r.reactionType === reaction.reactionType
    );

    return createdReaction || { id: "temp-id", ...reaction };
  } catch (error) {
    console.error(`Error adding reaction to message ${messageId}:`, error);
    throw error;
  }
}

export async function removeReaction(
  messageId,
  reactionId,
  userId,
  reactionType,
  token
) {
  try {
    // Formatul cerut de backend-ul Spring Boot

    const decodedToken = jwt.decode(token);
    const userId = decodedToken.userId || decodedToken.sub;

    if (!userId) {
      throw new Error("Could not extract user ID from token");
    }

    const payload = {
      user_id: userId,
      reaction_type: reactionType,
    };
    console.log(
      "Reacton to be DELETED: userId",
      userId,
      " reactionType: ",
      reactionType
    );
    const response = await fetch(
      `${API_SERVICE_URL}/api/messages/${messageId}/reactions`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to remove reaction: ${response.status}`);
    }
  } catch (error) {
    console.error(`Error removing reaction for message ${messageId}:`, error);
    throw error;
  }
}
/**
 * Creates a new message
 *
 * @param {Object} message - Message data
 * @param {string} token - JWT token for authentication
 * @returns {Promise<Object>} Created message data
 */
export async function createMessage(message, token) {
  try {
    // Decode token to extract user ID
    const decodedToken = jwt.decode(token);
    const userId = decodedToken.userId || decodedToken.sub;

    if (!userId) {
      throw new Error("Could not extract user ID from token");
    }

    // Format date to work with LocalDateTime on server
    const formattedDate = new Date().toISOString().replace(/\.\d{3}Z$/, "");

    // Prepare message with correct user ID and date format
    const messageWithUserId = {
      ...message,
      senderId: userId,
      createdAt: formattedDate,
      updatedAt: formattedDate,
    };

    console.log("Message to be sent with valid userId:", messageWithUserId);

    const response = await fetch(`${API_SERVICE_URL}/api/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messageWithUserId),
    });

    if (!response.ok) {
      throw new Error(`Failed to create message: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error creating message:", error);
    throw error;
  }
}
