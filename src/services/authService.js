import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:8080";

/**
 * Validates a token with the Spring Boot auth service
 *
 * @param {string} token - JWT token to validate
 * @returns {Promise<Object>} User data if token is valid
 * @throws {Error} If token is invalid
 */
export async function validateToken(token) {
  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/api/auth/validate`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Auth service responded with status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.valid) {
      throw new Error(`Token validation failed: ${data.message}`);
    }

    // Here you could fetch additional user info from your auth service
    // For now returning a simple user object
    return {
      id: data.userId || "user-id", // Ideally your validate endpoint should return userId
      name: data.username || "User Name",
    };
  } catch (error) {
    console.error("Token validation error:", error);
    throw new Error(`Authentication error: ${error.message}`);
  }
}

/**
 * Socket.IO authentication middleware
 */
export function authenticateSocket(socket, next) {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }

  validateToken(token)
    .then((user) => {
      socket.user = user;
      next();
    })
    .catch((error) => {
      next(new Error(error.message));
    });
}
