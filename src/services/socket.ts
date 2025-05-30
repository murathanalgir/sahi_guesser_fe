import { debounce } from "lodash";
import { io, Socket } from "socket.io-client";
import { useAuthStore } from "../store/authStore";
import { useGameStore } from "../store/gameStore";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../types/socket";
import { analyticsService } from "./analytics";
import { roomApi } from "./api";
import { soundService } from "./soundService";

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: Date;
}

class SocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null =
    null;

  private roomId: number | null = null;

  private optimisticMessageIds: Set<string> = new Set();

  connect(): void {
    const token = localStorage.getItem("token");
    let extraHeaders: Record<string, string> = {};
    if (token) {
      extraHeaders = {
        Authorization: `Bearer ${token}`,
      };
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL ?? "/";
    const isLocal = socketUrl.includes("local") || socketUrl.includes("192");

    this.socket = io(socketUrl, {
      path: isLocal ? "/socket.io/" : "/ws/socket.io/",
      autoConnect: false,
      extraHeaders,
      transportOptions: {
        websocket: {
          extraHeaders,
        },
      },
      query: {
        token,
      },
      transports: ["websocket"],
    });

    // if (!token) {
    //   console.log("No token, not connecting to socket");
    // } else {
    //   this.socket.connect();
    //   this.setupListeners();
    // }

    this.socket.connect();
    this.setupListeners();
  }

  reconnect(): void {
    if (this.socket) {
      // Clean up existing listeners and disconnect
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    // Establish new connection
    this.connect();
  }

  private setupListeners(): void {
    if (!this.socket) return;

    this.socket.on(
      "gameState",
      ({ status, listing, question, roundStartTime, roundDuration }) => {
        useGameStore.getState().setGameStatus(status);
        if (listing) {
          useGameStore.getState().setCurrentListing(listing);
        }
        if (question) {
          useGameStore.getState().setCurrentQuestion(question);
        }
        useGameStore
          .getState()
          .setRoundInfo(new Date(roundStartTime), roundDuration);

        useGameStore.getState().setRoomSummary(null);
        if (listing) {
          analyticsService.trackRoundStart(
            listing.id.toString(),
            listing.details.type
          );
        }
      }
    );

    this.socket.on(
      "intermissionStart",
      ({ duration, maxRounds, roundNumber }) => {
        const state = useGameStore.getState();

        state.setIntermissionDuration(duration);
        state.setGameStatus("INTERMISSION");
        soundService.scheduleCountdown(duration);
        state.setMaxRounds(maxRounds);
        state.setRoundNumber(roundNumber);
      }
    );

    this.socket.on("onlinePlayers", ({ players }) => {
      useGameStore.getState().setOnlinePlayers(players);
    });

    this.socket.on(
      "roundStart",
      ({ listing, question, duration, maxRounds, roundNumber }) => {
        const state = useGameStore.getState();

        state.setRoomSummary(null);
        state.setGuessCount(0);
        state.setGameStatus("PLAYING");
        state.setFeedback(null);
        state.setHasCorrectGuess(false);

        if (listing) {
          state.setCurrentListing(listing);
        }
        if (question) {
          state.setCurrentQuestion(question);
        }
        state.setRoundInfo(new Date(), duration);
        state.setShowResults(false);
        state.setRoundEndScores([]);
        state.setCorrectPrice(null);
        state.setLastGuesses([]);
        state.setCorrectGuesses([]);
        state.setIncorrectGuesses([]);

        state.setMaxRounds(maxRounds);
        state.setRoundNumber(roundNumber);

        if (listing) {
          analyticsService.trackRoundStart(
            listing.id.toString(),
            listing.details.type
          );
        }

        soundService.playRoundStart();
      }
    );

    this.socket.on("roundEnd", ({ correctPrice, scores }) => {
      const state = useGameStore.getState();
      const authState = useAuthStore.getState();

      let currentUserScore = 0;
      const onlinePlayers = state.onlinePlayers;
      const updatedOnlinePlayers = onlinePlayers.map((player) => {
        const score = scores.find((s) => s.playerId === player.playerId);
        if (player.userId === authState.user?.id) {
          currentUserScore = score?.userScore || 0;
        }
        return {
          ...player,
          totalScore: score?.userScore || 0,
          roomScore: score?.roomScore || 0,
        };
      });
      state.setOnlinePlayers(updatedOnlinePlayers);
      state.setCorrectPrice(correctPrice);
      state.setRoundEndScores(scores);

      state.setShowResults(true);

      if (authState.user) {
        authState.setUser({
          ...authState.user,
          score: currentUserScore,
        });
      }
    });

    // Debounce the guess result handler
    const debouncedGuessResult = debounce(
      (direction: "correct" | "go_higher" | "go_lower") => {
        useGameStore.getState().setFeedback(direction);
        if (direction === "correct") {
          useGameStore.getState().setHasCorrectGuess(true);
          soundService.playSuccess();
        } else {
          soundService.playFailure();
        }
      },
      100,
      { leading: true, trailing: false }
    );

    this.socket.on("guessResult", ({ direction, guessCount }) => {
      const state = useGameStore.getState();
      debouncedGuessResult(direction);

      state.setGuessCount(guessCount);
    });

    this.socket.on("correctGuess", ({ userId, playerId, username }) => {
      const authUser = useAuthStore.getState().user;
      if (userId !== authUser?.id) {
        soundService.playOtherPlayerSuccess();
      }

      useGameStore.getState().addCorrectGuess({
        userId,
        playerId,
        username,
        isCorrect: true,
      });
    });

    // Batch incorrect guesses
    let incorrectGuessBuffer: Array<{
      userId: number;
      playerId: number;
      username: string;
      isCorrect: false;
    }> = [];
    const flushIncorrectGuesses = debounce(() => {
      if (incorrectGuessBuffer.length > 0) {
        useGameStore.getState().setIncorrectGuesses(
          incorrectGuessBuffer.map((guess) => ({
            ...guess,
            isCorrect: false,
          }))
        );
        useGameStore
          .getState()
          .setLastGuesses(
            [
              ...incorrectGuessBuffer,
              ...useGameStore.getState().lastGuesses,
            ].slice(0, 5)
          );
        incorrectGuessBuffer = [];
      }
    }, 100);

    this.socket.on("incorrectGuess", (data) => {
      incorrectGuessBuffer.push({
        ...data,
        isCorrect: false,
      });
      flushIncorrectGuesses();
    });

    // Add message buffer and debounced flush function
    let chatMessageBuffer: Array<ChatMessage> = [];

    const flushChatMessages = debounce(() => {
      if (chatMessageBuffer.length > 0) {
        const state = useGameStore.getState();
        useGameStore
          .getState()
          .setChatMessages(
            [...state.chatMessages, ...chatMessageBuffer].slice(-100)
          );
        chatMessageBuffer = [];
      }
    }, 100);

    this.socket.on("chatMessage", ({ userId, username, message }) => {
      const state = useGameStore.getState();

      // Handle system message rejection
      if (username === "system" && message.startsWith("Mesajınız reddedildi")) {
        // Find the latest optimistic message from the user
        const latestOptimisticId = Array.from(this.optimisticMessageIds).pop();
        if (latestOptimisticId) {
          // Remove from tracking
          this.optimisticMessageIds.delete(latestOptimisticId);

          // Mark the message as rejected
          const updatedMessages = state.chatMessages.map((msg) =>
            msg.id === latestOptimisticId ? { ...msg, isRejected: true } : msg
          );

          useGameStore.getState().setChatMessages(updatedMessages);
        }

        // Add the system message
        chatMessageBuffer.push({
          id: new Date().getTime().toString(),
          userId: userId.toString(),
          username,
          message,
          timestamp: new Date(),
        });
        flushChatMessages();
        return;
      }

      const optimisticMessageId = Array.from(this.optimisticMessageIds).find(
        (id) => {
          const msg = state.chatMessages.find((m) => m.id === id);
          return (
            msg && msg.userId === userId.toString() && msg.message === message
          );
        }
      );

      if (optimisticMessageId) {
        // Remove the optimistic message ID from tracking
        this.optimisticMessageIds.delete(optimisticMessageId);

        // Filter out the optimistic message
        const filteredMessages = state.chatMessages.filter(
          (msg) => msg.id !== optimisticMessageId
        );

        // Add the server message
        const serverMessage = {
          id: new Date().getTime().toString(),
          userId: userId.toString(),
          username,
          message,
          timestamp: new Date(),
        };

        useGameStore
          .getState()
          .setChatMessages([...filteredMessages, serverMessage].slice(-100));
      } else {
        chatMessageBuffer.push({
          id: new Date().getTime().toString(),
          userId: userId.toString(),
          username,
          message,
          timestamp: new Date(),
        });
        flushChatMessages();
      }

      if (this.roomId) {
        analyticsService.trackChatMessage(this.roomId.toString());
      }
    });

    this.socket.on(
      "playerJoined",
      ({ userId, playerId, username, roomScore }) => {
        const onlinePlayers = useGameStore.getState().onlinePlayers;
        // check online players and add the new player if not exists.
        const isExists = onlinePlayers.some(
          (player) => player.playerId === playerId
        );
        if (isExists) {
          return;
        }
        useGameStore
          .getState()
          .setOnlinePlayers([
            ...onlinePlayers,
            { userId, playerId, username, roomScore, totalScore: 0 },
          ]);
      }
    );

    this.socket.on("playerLeft", ({ playerId }) => {
      const onlinePlayers = useGameStore.getState().onlinePlayers;
      useGameStore
        .getState()
        .setOnlinePlayers(
          onlinePlayers.filter((player) => player.playerId !== playerId)
        );
    });
    this.socket.on("roomEnded", () => {
      const state = useGameStore.getState();

      state.setRoomId(null);
      state.setRoom(null);
      state.setCurrentListing(null);
      state.setCurrentQuestion(null);
    });

    this.socket.on("roomEnd", () => {
      const state = useGameStore.getState();

      state.setRoomId(null);
      state.setRoom(null);
      state.setCurrentListing(null);
      state.setCurrentQuestion(null);
    });

    this.socket.on("serverShutdown", () => {
      const state = useGameStore.getState();

      state.setRoomId(null);
      state.setRoom(null);
      state.setCurrentListing(null);
      state.setCurrentQuestion(null);
      window.location.href = "/";
    });

    this.socket.on("reconnectRequired", () => {
      try {
        const state = useGameStore.getState();
        const roomId = state.roomId;
        if (roomId) {
          this.joinRoom(roomId, true);
        }
      } catch (error) {
        console.error("Error reconnecting to socket", error);
      }
    });

    this.socket.on("userBanned", ({ userId, roomId }) => {
      console.log("User banned", userId, roomId);
      if (userId === useAuthStore.getState().user?.id) {
        this.disconnect();
        window.location.href = "https://nolur.com";
      }
    });

    this.socket.on("roomCompleted", async ({ roomId }) => {
      console.log("Room completed", roomId);
      const state = useGameStore.getState();
      if (state.room && state.room.id === roomId) {
        const summary = await roomApi.getRoomSummary(state.room.slug);
        state.setRoomSummary(summary);
      }
    });

    this.socket?.io.on("reconnect", () => {
      try {
        const state = useGameStore.getState();
        const roomId = state.roomId;
        if (roomId) {
          this.joinRoom(roomId, true);
        }
      } catch (error) {
        console.error("Error reconnecting to socket", error);
      }
    });
  }

  joinRoom(roomId: number, isReconnect: boolean = false): void {
    if (this.roomId !== roomId || isReconnect) {
      this.socket?.emit("joinRoom", { roomId });
      useGameStore.getState().setRoomId(roomId);
    } else {
      console.log("Room already joined", roomId);
    }
  }

  sendMessage(roomId: number, message: string) {
    const authState = useAuthStore.getState();
    const user = authState.user;

    if (user) {
      // Add optimistic message
      const optimisticId = `${new Date().getTime()}-${Math.random()}`;
      const optimisticMessage = {
        id: optimisticId,
        userId: user.id.toString(),
        username: user.username,
        message,
        timestamp: new Date(),
      };

      // Track the optimistic message ID
      this.optimisticMessageIds.add(optimisticId);

      useGameStore
        .getState()
        .setChatMessages(
          [...useGameStore.getState().chatMessages, optimisticMessage].slice(
            -100
          )
        );
    }

    this.socket?.emit("chatMessage", { roomId, message });
  }

  leaveRoom(roomId: number): void {
    this.socket?.emit("leaveRoom", { roomId });
    useGameStore.getState().setRoomId(null);

    useGameStore.getState().setCurrentListing(null);
    useGameStore.getState().setCurrentQuestion(null);
    soundService.clearCountdownTimeout();
  }

  submitGuess(roomId: number, price: number): void {
    this.socket?.emit("submitGuess", { roomId, price });
  }

  disconnect(): void {
    soundService.clearCountdownTimeout();
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketService = new SocketService();
