import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { Room, RoomSummary } from "../services/api";
import { ChatMessage, GuessResult } from "../types";
import type {
  GameStatus,
  Listing,
  OnlinePlayer,
  Player,
  Question,
  RoundEndScore,
} from "../types/socket";

interface GameState {
  status: GameStatus;
  currentListing: Listing | null;
  currentQuestion: Question | null;
  roundStartTime: Date | null;
  roundDuration: number;
  players: Player[];
  roomId: number | null;
  room: Room | null;
  feedback: "correct" | "go_higher" | "go_lower" | null;
  hasCorrectGuess: boolean;
  chatMessages: ChatMessage[];
  onlinePlayers: OnlinePlayer[];
  correctGuesses: GuessResult[];
  incorrectGuesses: GuessResult[];
  correctPrice: number | null;
  roundEndScores: RoundEndScore[];
  guessCount: number;
  lastGuesses: GuessResult[];
  showResults: boolean;
  intermissionDuration: number;
  roomSummary: RoomSummary | null;
  maxRounds: number;
  roundNumber: number;
  setGameStatus: (status: GameStatus) => void;
  setCurrentListing: (listing: Listing | null) => void;
  setCurrentQuestion: (question: Question | null) => void;
  setRoundInfo: (startTime: Date, duration: number) => void;
  setPlayers: (players: Player[]) => void;
  setRoomId: (roomId: number | null) => void;
  setRoom: (room: Room | null) => void;
  setFeedback: (feedback: "correct" | "go_higher" | "go_lower" | null) => void;
  setHasCorrectGuess: (hasCorrectGuess: boolean) => void;
  setChatMessages: (chatMessages: ChatMessage[]) => void;
  setOnlinePlayers: (onlinePlayers: OnlinePlayer[]) => void;
  addCorrectGuess: (guess: GuessResult) => void;
  addIncorrectGuess: (guess: GuessResult) => void;
  setCorrectPrice: (correctPrice: number | null) => void;
  setRoundEndScores: (roundEndScores: RoundEndScore[]) => void;
  setShowResults: (showResults: boolean) => void;
  setLastGuesses: (lastGuesses: GuessResult[]) => void;
  setCorrectGuesses: (correctGuesses: GuessResult[]) => void;
  setIncorrectGuesses: (incorrectGuesses: GuessResult[]) => void;
  setGuessCount: (guessCount: number) => void;
  setIntermissionDuration: (intermissionDuration: number) => void;
  setRoomSummary: (roomSummary: RoomSummary | null) => void;
  setMaxRounds: (maxRounds: number) => void;
  setRoundNumber: (roundNumber: number) => void;
}

export const useGameStore = create<GameState>()(
  devtools((set) => ({
    status: "WAITING",
    currentListing: null,
    currentQuestion: null,
    roundStartTime: null,
    roundDuration: 0,
    players: [],
    roomId: null,
    room: null,
    feedback: null,
    guessCount: 0,
    hasCorrectGuess: false,
    correctGuesses: [],
    incorrectGuesses: [],
    lastGuesses: [],
    chatMessages: [],
    onlinePlayers: [],
    correctPrice: null,
    roundEndScores: [],
    showResults: false,
    intermissionDuration: 0,
    roomSummary: null,
    maxRounds: 0,
    roundNumber: 0,
    setGameStatus: (status) =>
      set({
        status,
        hasCorrectGuess: false,
        feedback: null,
        correctGuesses: [],
        incorrectGuesses: [],
      }),
    setCurrentListing: (listing) => {
      set({
        currentListing: listing,
        correctGuesses: [],
        incorrectGuesses: [],
        showResults: false,
        roundEndScores: [],
        correctPrice: null,
      });
    },
    setCurrentQuestion: (question) =>
      set({
        currentQuestion: question,
        correctGuesses: [],
        incorrectGuesses: [],
        showResults: false,
        roundEndScores: [],
        correctPrice: null,
      }),
    setRoundInfo: (startTime, duration) =>
      set({ roundStartTime: startTime, roundDuration: duration }),
    setPlayers: (players) => set({ players }),
    setRoomId: (roomId) => set({ roomId, chatMessages: [] }),
    setGuessCount: (guessCount) => set({ guessCount }),
    setRoom: (room) => set({ room }),
    setFeedback: (feedback) => set({ feedback }),
    setHasCorrectGuess: (hasCorrectGuess) => set({ hasCorrectGuess }),
    setChatMessages: (chatMessages) => set({ chatMessages }),
    setOnlinePlayers: (onlinePlayers) => set({ onlinePlayers }),
    addCorrectGuess: (guess) =>
      set((state) => ({
        correctGuesses: [...state.correctGuesses, guess],
        lastGuesses: [guess, ...state.lastGuesses].slice(0, 5),
      })),
    addIncorrectGuess: (guess) =>
      set((state) => ({
        incorrectGuesses: [...state.incorrectGuesses, guess],
        lastGuesses: [guess, ...state.lastGuesses].slice(0, 5),
      })),

    setCorrectGuesses: (correctGuesses) => set({ correctGuesses }),
    setIncorrectGuesses: (incorrectGuesses) => set({ incorrectGuesses }),
    setLastGuesses: (lastGuesses) => set({ lastGuesses }),
    setCorrectPrice: (correctPrice) => set({ correctPrice }),
    setRoundEndScores: (roundEndScores) => set({ roundEndScores }),
    setShowResults: (showResults) => set({ showResults }),
    setIntermissionDuration: (intermissionDuration) =>
      set({ intermissionDuration }),
    setRoomSummary: (roomSummary) => set({ roomSummary }),
    setMaxRounds: (maxRounds) => set({ maxRounds }),
    setRoundNumber: (roundNumber) => set({ roundNumber }),
  }))
);
