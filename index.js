const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  },
});

const rooms = {}; // Stores room data

// Utility to generate shuffled 5x5 board with numbers 1–25
function generateBoard() {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

function countCompletedLines(marks) {
  const matrix = [];
  for (let i = 0; i < 5; i++) matrix.push(marks.slice(i * 5, (i + 1) * 5));

  let lines = 0;

  // Rows & Columns
  for (let i = 0; i < 5; i++) {
    if (matrix[i].every(Boolean)) lines++;
    if (matrix.map(row => row[i]).every(Boolean)) lines++;
  }

  // Diagonals
  if ([0, 1, 2, 3, 4].every(i => matrix[i][i])) lines++;
  if ([0, 1, 2, 3, 4].every(i => matrix[i][4 - i])) lines++;

  return lines;
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('create-room', ({ name }) => {
    const roomCode = uuidv4().slice(0, 5).toUpperCase();

    rooms[roomCode] = {
      players: {
        [socket.id]: {
          name,
          board: generateBoard(),
          marks: Array(25).fill(false),
        },
      },
      turn: socket.id,
    };

    socket.join(roomCode);
    socket.emit('room-created', {
      roomCode,
      board: rooms[roomCode].players[socket.id].board,
    });

    console.log(`Room ${roomCode} created by ${name}`);
  });

  socket.on('join-room', ({ roomCode, name }) => {
    roomCode = roomCode.toUpperCase();
    const room = rooms[roomCode];

    if (!room) {
      socket.emit('error', 'Room does not exist.');
      return;
    }

    const playerCount = Object.keys(room.players).length;
    if (playerCount >= 2) {
      socket.emit('error', 'Room is already full.');
      return;
    }

    room.players[socket.id] = {
      name,
      board: generateBoard(),
      marks: Array(25).fill(false),
    };

    socket.join(roomCode);

    // Start game when two players are connected
    if (Object.keys(room.players).length === 2) {
      io.to(roomCode).emit('game-start', {
        boards: Object.fromEntries(
          Object.entries(room.players).map(([id, data]) => [id, data.board])
        ),
        players: Object.keys(room.players),
        turn: room.turn,
      });
    }
  });

  socket.on('call-number', ({ roomCode, number }) => {
    const room = rooms[roomCode];
    if (!room || room.turn !== socket.id) return;

    // Update marks for all players
    for (const [id, player] of Object.entries(room.players)) {
      const idx = player.board.indexOf(number);
      if (idx !== -1) player.marks[idx] = true;
    }

    // Check for winner
    for (const [id, player] of Object.entries(room.players)) {
      const lines = countCompletedLines(player.marks);
      if (lines >= 5) {
        io.to(roomCode).emit('game-over', { winner: player.name });
        return;
      }
    }

    // Change turn to the other player
    const playerIds = Object.keys(room.players);
    const nextTurn = playerIds.find(id => id !== socket.id);
    room.turn = nextTurn;

    const allMarks = Object.fromEntries(
      Object.entries(room.players).map(([id, data]) => [id, data.marks])
    );

    io.to(roomCode).emit('number-called', {
      number,
      marks: allMarks,
      turn: room.turn,
    });
  });

  socket.on('disconnect', () => {
    console.log(`Socket ${socket.id} disconnected`);
    for (const [roomCode, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(roomCode).emit('error', 'A player has disconnected. Game ended.');
        delete rooms[roomCode];
        break;
      }
    }
  });
});

server.listen(5000, () => {
  console.log('Server running on port 5000');
});
