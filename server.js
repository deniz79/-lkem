const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

let db;

async function startServer() {
  // Veritabanını dinamik olarak import et ve başlat
  const { Low, JSONFile } = await import('lowdb');
  const adapter = new JSONFile('db.json');
  const defaultData = { players: [] };
  db = new Low(adapter, defaultData);
  await db.read();
  console.log('Veritabanı başarıyla yüklendi.');

  const app = express();
  const server = http.createServer(app);
  const io = new socketIo(server);

  const PORT = process.env.PORT || 3000;

  // Statik dosyaları sun
  app.use(express.static(path.join(__dirname, 'public')));

  // Oyun odaları ve oyuncular (hafızada tutulacak)
  const rooms = new Map();
  const players = new Map();

  // Mağaza ürünleri
  const THEMES = [
    { id: 'default', name: 'Varsayılan', price: 0, cssClass: 'theme-default' },
    { id: 'dark', name: 'Karanlık Mod', price: 500, cssClass: 'theme-dark' },
    { id: 'forest', name: 'Orman Esintisi', price: 750, cssClass: 'theme-forest' },
    { id: 'ocean', name: 'Okyanus Ferahlığı', price: 750, cssClass: 'theme-ocean' }
  ];

  // Ülke verileri
  const countries = [
    { name: 'Türkiye', flag: '🇹🇷', code: 'TR' }, { name: 'Almanya', flag: '🇩🇪', code: 'DE' }, { name: 'Fransa', flag: '🇫🇷', code: 'FR' }, { name: 'İtalya', flag: '🇮🇹', code: 'IT' }, { name: 'İspanya', flag: '🇪🇸', code: 'ES' }, { name: 'İngiltere', flag: '🇬🇧', code: 'GB' }, { name: 'Hollanda', flag: '🇳🇱', code: 'NL' }, { name: 'Belçika', flag: '🇧🇪', code: 'BE' }, { name: 'Portekiz', flag: '🇵🇹', code: 'PT' }, { name: 'Yunanistan', flag: '🇬🇷', code: 'GR' }, { name: 'Polonya', flag: '🇵🇱', code: 'PL' }, { name: 'Çek Cumhuriyeti', flag: '🇨🇿', code: 'CZ' }, { name: 'Macaristan', flag: '🇭🇺', 'HU' }, { name: 'Romanya', flag: '🇷🇴', code: 'RO' }, { name: 'Bulgaristan', flag: '🇧🇬', code: 'BG' }, { name: 'Hırvatistan', flag: '🇭🇷', code: 'HR' }, { name: 'Slovakya', flag: '🇸🇰', code: 'SK' }, { name: 'Slovenya', flag: '🇸🇮', code: 'SI' }, { name: 'Litvanya', flag: '🇱🇹', code: 'LT' }, { name: 'Letonya', flag: '🇱🇻', code: 'LV' }, { name: 'Estonya', flag: '🇪🇪', code: 'EE' }, { name: 'Finlandiya', flag: '🇫🇮', code: 'FI' }, { name: 'İsveç', flag: '🇸🇪', code: 'SE' }, { name: 'Norveç', flag: '🇳🇴', code: 'NO' }, { name: 'Danimarka', flag: '🇩🇰', code: 'DK' }, { name: 'İrlanda', flag: '🇮🇪', code: 'IE' }, { name: 'Avusturya', flag: '🇦🇹', code: 'AT' }, { name: 'İsviçre', flag: '🇨🇭', code: 'CH' }, { name: 'Lüksemburg', flag: '🇱🇺', code: 'LU' }, { name: 'Malta', flag: '🇲🇹', code: 'MT' }, { name: 'Kıbrıs', flag: '🇨🇾', code: 'CY' }, { name: 'ABD', flag: '🇺🇸', code: 'US' }, { name: 'Kanada', flag: '🇨🇦', code: 'CA' }, { name: 'Meksika', flag: '🇲🇽', code: 'MX' }, { name: 'Brezilya', flag: '🇧🇷', code: 'BR' }, { name: 'Arjantin', flag: '🇦🇷', code: 'AR' }, { name: 'Japonya', flag: '🇯🇵', code: 'JP' }, { name: 'Rusya', flag: '🇷🇺', code: 'RU' }
  ];

  // Rastgele ülke seçme fonksiyonu
  function getRandomCountries(count) {
    const shuffled = [...countries].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  // Oda oluşturma
  function createRoom() {
    const roomId = uuidv4().substring(0, 8);
    const room = {
      id: roomId,
      players: [],
      gameState: 'waiting',
      currentRound: 0,
      maxRounds: 10,
      questions: [],
      scores: {},
      startTime: null,
      isSinglePlayer: false
    };
    rooms.set(roomId, room);
    return roomId;
  }
  
  // Oyuncu skorlarını veritabanında güncelleme
  async function updatePlayerScores(results) {
    try {
      await db.read();
      results.forEach(result => {
        if (result.name === 'Bot') return; 

        let playerInDb = db.data.players.find(p => p.name === result.name);
        if (playerInDb) {
          playerInDb.totalScore += result.score;
        } else {
          db.data.players.push({
            id: uuidv4(),
            name: result.name,
            totalScore: result.score,
            purchasedThemes: ['default'],
            activeTheme: 'default'
          });
        }
      });
      await db.write();
      console.log('Skorlar veritabanına kaydedildi.');
    } catch (error) {
      console.error('Skorlar kaydedilirken hata oluştu:', error);
    }
  }

  // Oyunu başlatma
  function startGame(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.gameState = 'playing';
    room.currentRound = 0;
    room.questions = getRandomCountries(10);
    room.startTime = Date.now();
    
    room.players.forEach(player => {
      room.scores[player.id] = 0;
      player.score = 0;
    });

    io.to(roomId).emit('game-started', {
      players: room.players,
      totalRounds: room.maxRounds
    });

    nextRound(roomId);
  }

  // Sonraki tur
  function nextRound(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.currentRound++;
    
    if (room.currentRound > room.maxRounds) {
      endGame(roomId);
      return;
    }

    room.players.forEach(player => {
      player.currentAnswer = null;
      player.answerTime = null;
    });

    const currentQuestion = room.questions[room.currentRound - 1];
    const options = getRandomCountries(4);
    
    if (!options.find(opt => opt.name === currentQuestion.name)) {
      options[0] = currentQuestion;
    }

    const shuffledOptions = options.sort(() => 0.5 - Math.random());

    io.to(roomId).emit('new-round', {
      round: room.currentRound,
      question: currentQuestion,
      options: shuffledOptions,
      players: room.players
    });

    if (room.isSinglePlayer) {
      const botPlayer = room.players.find(p => p.isBot);
      if (botPlayer) {
        const randomDelay = Math.random() * 3000 + 2000;
        setTimeout(() => {
          const randomAnswer = shuffledOptions[Math.floor(Math.random() * shuffledOptions.length)];
          botPlayer.currentAnswer = randomAnswer.name;
          botPlayer.answerTime = Date.now();
        }, randomDelay);
      }
    }
  }

  // Turu değerlendirme
  function evaluateRound(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.questions[room.currentRound - 1]) return;

    const correctAnswer = room.questions[room.currentRound - 1].name;
    const roundResults = [];

    room.players.forEach(player => {
      let points = 0;
      if (player.currentAnswer === correctAnswer) {
        points = 10;
        const answerSeconds = (player.answerTime - room.startTime - (room.currentRound - 1) * 10000) / 1000;
        points += Math.max(0, 10 - Math.floor(answerSeconds));
      }
      room.scores[player.id] = (room.scores[player.id] || 0) + points;
      player.score = room.scores[player.id];
      roundResults.push({
        playerId: player.id,
        playerName: player.name,
        answer: player.currentAnswer,
        correct: player.currentAnswer === correctAnswer,
        points: points,
        totalScore: player.score
      });
    });

    io.to(roomId).emit('round-finished', {
      results: roundResults,
      correctAnswer: correctAnswer
    });

    setTimeout(() => nextRound(roomId), 4000);
  }

  // Oyunu bitirme
  function endGame(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.gameState = 'finished';
    
    const finalResults = room.players.map(player => ({
      id: player.id,
      name: player.name,
      score: room.scores[player.id] || 0
    })).sort((a, b) => b.score - a.score);

    updatePlayerScores(finalResults);
  
    io.to(roomId).emit('game-finished', {
      results: finalResults,
      winner: finalResults[0]
    });
  }

  // Socket.IO bağlantı yönetimi
  io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    socket.on('join-room', (data) => {
      const { roomId, playerName } = data;
      const room = rooms.get(roomId);
      
      if (!room) return socket.emit('error', { message: 'Oda bulunamadı' });
      if (room.players.length >= 2) return socket.emit('error', { message: 'Oda dolu' });

      const player = { id: socket.id, name: playerName, score: 0, isBot: false };
      room.players.push(player);
      room.scores[socket.id] = 0;
      players.set(socket.id, { roomId, playerName });
      socket.join(roomId);

      io.to(roomId).emit('player-joined', { players: room.players, gameState: room.gameState });

      if (room.players.length === 2) {
        startGame(roomId);
      }
    });

    socket.on('start-single-player', (data) => {
      const { playerName } = data;
      const roomId = createRoom();
      const room = rooms.get(roomId);
      room.isSinglePlayer = true;

      const humanPlayer = { id: socket.id, name: playerName, score: 0, currentAnswer: null, answerTime: null, isBot: false };
      room.players.push(humanPlayer);
      room.scores[socket.id] = 0;
      players.set(socket.id, { roomId, playerName });
      socket.join(roomId);

      const botPlayer = { id: `bot-${roomId}`, name: 'Bot', score: 0, currentAnswer: null, answerTime: null, isBot: true };
      room.players.push(botPlayer);
      room.scores[botPlayer.id] = 0;
      
      startGame(roomId);
    });

    socket.on('submit-answer', (data) => {
      const { answer } = data;
      const playerInfo = players.get(socket.id);
      
      if (!playerInfo) return;
      const room = rooms.get(playerInfo.roomId);
      if (!room || room.gameState !== 'playing') return;

      const player = room.players.find(p => p.id === socket.id);
      if (!player || player.currentAnswer !== null) return;

      player.currentAnswer = answer;
      player.answerTime = Date.now();

      const allAnswered = room.players.every(p => p.currentAnswer !== null);
      
      if (allAnswered) {
        setTimeout(() => evaluateRound(playerInfo.roomId), 1000);
      }
    });

    // Mağaza verisi isteği
    socket.on('get-store-data', async (data) => {
      if (!data || !data.playerName) return;
      await db.read();
      let player = db.data.players.find(p => p.name === data.playerName);
      
      // Eğer oyuncu bir şekilde DB'de yoksa, oluştur
      if (!player) {
        player = {
          id: uuidv4(),
          name: data.playerName,
          totalScore: 0,
          purchasedThemes: ['default'],
          activeTheme: 'default'
        };
        db.data.players.push(player);
        await db.write();
      }

      socket.emit('store-data', {
        themes: THEMES,
        playerData: player
      });
    });

    // Tema satın alma
    socket.on('purchase-theme', async (data) => {
      if (!data || !data.playerName || !data.themeId) return;
      
      const theme = THEMES.find(t => t.id === data.themeId);
      if (!theme) return socket.emit('error', { message: 'Tema bulunamadı.' });

      await db.read();
      let player = db.data.players.find(p => p.name === data.playerName);
      if (!player) return socket.emit('error', { message: 'Oyuncu bulunamadı.' });

      if (player.totalScore < theme.price) return socket.emit('error', { message: 'Yetersiz puan.' });
      if (player.purchasedThemes.includes(theme.id)) return socket.emit('error', { message: 'Bu temaya zaten sahipsin.' });

      player.totalScore -= theme.price;
      player.purchasedThemes.push(theme.id);
      await db.write();

      socket.emit('store-data', { themes: THEMES, playerData: player });
      socket.emit('notification', { message: `${theme.name} başarıyla satın alındı!` });
    });

    // Aktif tema belirleme
    socket.on('set-active-theme', async (data) => {
      if (!data || !data.playerName || !data.themeId) return;
      
      await db.read();
      let player = db.data.players.find(p => p.name === data.playerName);
      if (!player) return socket.emit('error', { message: 'Oyuncu bulunamadı.' });

      if (!player.purchasedThemes.includes(data.themeId)) return socket.emit('error', { message: 'Bu temaya sahip değilsin.'});

      player.activeTheme = data.themeId;
      await db.write();
      
      const activeTheme = THEMES.find(t => t.id === player.activeTheme);
      socket.emit('store-data', { themes: THEMES, playerData: player });
      socket.emit('notification', { message: `${activeTheme.name} teması aktifleştirildi!` });
    });

    socket.on('get-leaderboard', async () => {
      try {
        await db.read();
        const topPlayers = db.data.players.sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);
        socket.emit('leaderboard-data', topPlayers);
      } catch (error) {
        console.error('Liderlik tablosu alınırken hata:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('Bağlantı kesildi:', socket.id);
      const playerInfo = players.get(socket.id);
      if (playerInfo) {
        const room = rooms.get(playerInfo.roomId);
        if (room) {
          room.players = room.players.filter(p => p.id !== socket.id);
          if (room.gameState === 'playing' && room.players.length < 2) {
             io.to(playerInfo.roomId).emit('player-disconnected', { message: `${playerInfo.playerName} oyundan ayrıldı.` });
             endGame(playerInfo.roomId);
          }
        }
        players.delete(socket.id);
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
  });
}

startServer().catch(err => console.error('Sunucu başlatılamadı:', err)); 