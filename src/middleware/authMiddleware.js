import jwt from "jsonwebtoken";
import apiService from "../services/apiService.js";

export const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    console.log("Token in middleware: " + token);
    // Verifică tokenul cu backend-ul Spring Boot
    const isValid = await apiService.validateToken(token);
    console.log("Is valid: " + isValid);
    if (!isValid) {
      return next(new Error("Authentication error: Invalid token"));
    }

    // Decodează tokenul pentru a obține informații despre user
    const decoded = jwt.decode(token);
    socket.user = {
      id: decoded.sub,
      name: decoded.name,
      roles: decoded.roles || [],
    };

    next();
  } catch (err) {
    next(new Error("Authentication error: " + err.message));
  }
};

export default {
  authenticateSocket,
};
