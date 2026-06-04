const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Раздаем статические файлы фронтенда из папки public
app.use(express.static(path.join(__dirname, 'public')));

let serviceAccount;

try {
    if (process.env.FIREBASE_KEYS_JSON) {
        // Если мы в облаке Vercel, парсим текст из Environment Variables
        serviceAccount = JSON.parse(process.env.FIREBASE_KEYS_JSON);
    } else {
        // Если мы тестируем локально на ПК, читаем файл из корня
        serviceAccount = require('../firebase-keys.json');
    }

    // Инициализируем Firebase Admin, только если он еще не поднят
    if (admin.apps.length === 0) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (initError) {
    console.error("Критическая ошибка инициализации Firebase Admin:", initError.message);
}

const db = admin.firestore();

// Весь список игроков дублируем на бэкенде для безопасных расчетов очков
const PLAYERS = [
    { id: 1, name: 'apEx', team: 'Vitality', role: 'Капитан', rating: 0.99 },
    { id: 2, name: 'ropz', team: 'Vitality', role: 'Рифлер', rating: 1.18 },
    { id: 3, name: 'ZywOo', team: 'Vitality', role: 'Снайпер', rating: 1.37 },
    { id: 4, name: 'flameZ', team: 'Vitality', role: 'Рифлер', rating: 1.18 },
    { id: 5, name: 'mezii', team: 'Vitality', role: 'Рифлер', rating: 1.05 },
    { id: 6, name: 'Aleksib', team: 'Natus Vincere', role: 'Капитан', rating: 0.91 },
    { id: 7, name: 'iM', team: 'Natus Vincere', role: 'Рифлер', rating: 1.08 },
    { id: 8, name: 'b1t', team: 'Natus Vincere', role: 'Рифлер', rating: 1.12 },
    { id: 9, name: 'w0nderful', team: 'Natus Vincere', role: 'Снайпер', rating: 1.18 },
    { id: 10, name: 'makazze', team: 'Natus Vincere', role: 'Рифлер', rating: 1.21 },
    { id: 11, name: 'sh1ro', team: 'Spirit', role: 'Снайпер', rating: 1.14 },
    { id: 12, name: 'magixx', team: 'Spirit', role: 'Капитан', rating: 1.02 },
    { id: 13, name: 'tN1R', team: 'Spirit', role: 'Рифлер', rating: 1.04 },
    { id: 14, name: 'zont1x', team: 'Spirit', role: 'Рифлер', rating: 0.95 },
    { id: 15, name: 'donk', team: 'Spirit', role: 'Рифлер', rating: 1.41 }
];
// Middleware для проверки Firebase токена пользователя
const authenticateFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Токен отсутствует" });

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        return res.status(403).json({ error: "Невалидный токен" });
    }
};

// Загрузка профиля (очки + текущий состав + статус блокировки)
// Загрузка профиля пользователя + глобальных настроек турнира (дедлайна)
app.get('/api/get-profile', authenticateFirebaseToken, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        const configDoc = await db.collection('settings').doc('tournament').get();
        let deadline = null;
        if (configDoc.exists) {
            deadline = configDoc.data().deadline;
        }

        let isLocked = false;
        let userData = { score: 0, currentTeam: [], starPlayerId: null, username: 'Player' };

        if (userDoc.exists) {
            userData = userDoc.data();
            isLocked = userData.isLocked || false;
        }

        if (deadline && new Date() > new Date(deadline)) {
            isLocked = true;
        }

        res.json({
            success: true,
            data: {
                username: userData.username || req.user.email.split('@')[0], // Защита: если никнейма нет, берем часть почты
                email: userData.email || req.user.email,
                score: userData.score || 0,
                isLocked: isLocked,
                currentTeam: userData.currentTeam || [],
                starPlayerId: userData.starPlayerId || null,
                deadline: deadline
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// Создание базового профиля при первой авторизации
app.post('/api/create-profile', authenticateFirebaseToken, async (req, res) => {
    try {
        const { username } = req.body; // Забираем никнейм из тела запроса
        const userRef = db.collection('users').doc(req.user.uid);
        const doc = await userRef.get();

        if (!doc.exists) {
            await userRef.set({
                email: req.user.email,
                username: username || req.user.email.split('@')[0], // сохраняем никнейм
                score: 0,
                isLocked: false,
                currentTeam: [],
                starPlayerId: null
            });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/lock-team', authenticateFirebaseToken, async (req, res) => {
    const { teamIds, starPlayerId } = req.body;

    if (!teamIds || teamIds.length !== 5 || !starPlayerId) {
        return res.status(400).json({ success: false, message: "Неверный формат состава!" });
    }

    try {
        const userRef = db.collection('users').doc(req.user.uid);
        const doc = await userRef.get();

        if (doc.exists && doc.data().isLocked) {
            return res.status(400).json({ success: false, message: "Ваш состав уже заблокирован на этот тур!" });
        }

        // 1. Проверяем уникальность ID (защита от копирования одного сильного игрока)
        const uniqueIds = [...new Set(teamIds)];
        if (uniqueIds.length !== 5) {
            return res.status(400).json({ success: false, message: "В команде не может быть дубликатов игроков!" });
        }

        // 2. Проверяем строгие лимиты организаций (не более 2 из одного клуба)
        const teamCounts = {};
        const slotsValidation = [
            { role: 'Капитан', player: null },
            { role: 'Рифлер', player: null },
            { role: 'Рифлер', player: null },
            { role: 'Рифлер', player: null },
            { role: 'Снайпер', player: null }
        ];

        for (let i = 0; i < teamIds.length; i++) {
            const pId = teamIds[i];
            const player = PLAYERS.find(p => p.id === pId);

            if (!player) {
                return res.status(400).json({ success: false, message: "Один из игроков не найден в официальной базе!" });
            }

            // Считаем лимит организации
            teamCounts[player.team] = (teamCounts[player.team] || 0) + 1;
            if (teamCounts[player.team] > 2) {
                return res.status(400).json({ success: false, message: `Нарушен лимит клуба! Нельзя брать больше 2 игроков из ${player.team}.` });
            }

            // Привязываем игрока к проверяемому слоту
            slotsValidation[i].player = player;
        }

        // 3. Проверяем соответствие ролей игроков их слотам на фронтенде
        for (let i = 0; i < slotsValidation.length; i++) {
            if (slotsValidation[i].player.role !== slotsValidation[i].role) {
                return res.status(400).json({ success: false, message: `Нарушено распределение позиций! Игрок ${slotsValidation[i].player.name} не подходит на роль ${slotsValidation[i].role}.` });
            }
        }

        // 4. Проверяем, входит ли звездный игрок в текущий состав
        if (!teamIds.includes(starPlayerId)) {
            return res.status(400).json({ success: false, message: "Звездный игрок должен быть частью вашей команды!" });
        }

        // Если все проверки пройдены — сохраняем в базу данных
        await userRef.update({
            currentTeam: teamIds,
            starPlayerId: starPlayerId,
            isLocked: true
        });

        res.json({ success: true, message: "Состав успешно проверен бэкендом и зафиксирован!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Эндпоинт таблицы лидеров (ТОП предсказателей)
app.get('/api/leaderboard', async (req, res) => {
    try {
        const snapshot = await db.collection('users').orderBy('score', 'desc').get();
        const users = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // 🔒 Публикуем в общий доступ исключительно никнейм (username)
            users.push({ username: data.username || 'Anonymous', score: data.score || 0 });
        });
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
// 👑 ОБНОВЛЕННЫЙ АДМИНСКИЙ ЭНДПОИНТ: РАСЧЕТ МАТЧА ПО РЕАЛЬНЫМ ДАННЫМ HLTV
app.post('/api/admin/submit-match-stats', async (req, res) => {
    const { secretKey, playerStats } = req.body;

    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(403).json({ success: false, message: "Доступ запрещен" });
    }
    if (!playerStats || Object.keys(playerStats).length === 0) {
        return res.status(400).json({ success: false, message: "Данные статистики пусты!" });
    }

    try {
        const calculatedPlayerPoints = {};

        // [Ваша математика подсчета очков игроков остается без изменений]
        for (const playerId in playerStats) {
            const stats = playerStats[playerId];
            const pId = parseInt(playerId);
            const player = PLAYERS.find(p => p.id === pId);
            if (!player) continue;

            const kills = parseInt(stats.kills) || 0;
            const deaths = parseInt(stats.deaths) || 1;
            const assists = parseInt(stats.assists) || 0;
            const flashAssists = parseInt(stats.flashAssists) || 0;
            const entryKills = parseInt(stats.entryKills) || 0;
            const entryDeaths = parseInt(stats.entryDeaths) || 0;
            const clutchesCount = parseInt(stats.clutches) || 0;
            const multikillsCount = parseInt(stats.multikills) || 0;
            const adr = parseFloat(stats.adr) || 75.0;
            const swingPercentage = parseFloat(stats.swing) || 5.0;
            const officialRating = parseFloat(stats.rating) || 1.00;

            const kdRatio = parseFloat((kills / deaths).toFixed(2));
            let kdNorm = 1.0, kdWeight = 20;
            if (player.role === 'Снайпер') { kdNorm = 1.15; kdWeight = 25; }
            else if (player.role === 'Рифлер') { kdNorm = 1.05; kdWeight = 20; }
            else if (player.role === 'Капитан') { kdNorm = 0.90; kdWeight = 12; }

            let basePoints = 0;
            basePoints += kills * 5;
            basePoints += assists * 3;
            basePoints += flashAssists * 2;
            const finalEntryDeaths = entryDeaths === 0 ? 1 : entryDeaths;
            basePoints += Math.round(parseFloat((entryKills / finalEntryDeaths).toFixed(2)) * 20);
            basePoints += clutchesCount * 15;
            basePoints += multikillsCount * 3;
            basePoints += Math.round((adr - 75) * 1.5);
            basePoints += Math.round((swingPercentage - 5.0) * 8);
            basePoints += Math.round((kdRatio - kdNorm) * kdWeight);

            if (officialRating > 1.0) {
                basePoints += Math.floor((officialRating - 1.0) / 0.10) * 15;
            }
            calculatedPlayerPoints[pId] = Math.max(0, basePoints);
        }

        const usersSnapshot = await db.collection('users').get();
        const batch = db.batch();
        let activeUsersCount = 0;

        usersSnapshot.forEach(userDoc => {
            const userData = userDoc.data();

            // Начисляем очки только если состав закреплен
            if (userData.isLocked && userData.currentTeam && userData.currentTeam.length === 5) {
                let userMatchPoints = 0;

                userData.currentTeam.forEach(playerId => {
                    if (calculatedPlayerPoints[playerId] !== undefined) {
                        let points = calculatedPlayerPoints[playerId];
                        if (userData.starPlayerId === playerId) {
                            points = Math.round(points * 1.5);
                        }
                        userMatchPoints += points;
                    }
                });

                if (userMatchPoints > 0) {
                    activeUsersCount++;
                    const newScore = (userData.score || 0) + userMatchPoints;
                    const userRef = db.collection('users').doc(userDoc.id);

                    // 🔥 ИСПРАВЛЕНО: Просто обновляем очки. НЕ сбрасываем состав и НЕ открываем рынок!
                    batch.update(userRef, { score: newScore });
                }
            }
        });

        await batch.commit();
        res.json({ success: true, message: `Очки за матч успешно добавлены для ${activeUsersCount} участников лиги. Составы остаются заблокированными до завершения тура.` });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 👑 2. НОВЫЙ ЭНДПОИНТ: ОФИЦИАЛЬНОЕ ЗАКРЫТИЕ ВСЕГО ТУРА (ОТКРЫВАЕТ РЫНОК ДЛЯ СЛЕДУЮЩЕГО ТУРА)
app.post('/api/admin/close-tour', async (req, res) => {
    const { secretKey } = req.body;
    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(403).json({ success: false, message: "Доступ запрещен" });
    }

    try {
        const usersSnapshot = await db.collection('users').get();
        const batch = db.batch();

        usersSnapshot.forEach(userDoc => {
            const userData = userDoc.data();
            const userRef = db.collection('users').doc(userDoc.id);

            // Если у пользователя был состав в этом туре, берем его историю или создаем массив
            const history = userData.history || [];

            if (userData.currentTeam && userData.currentTeam.length === 5) {
                // Записываем архивный слепок тура
                history.push({
                    tour: history.length + 1,
                    team: userData.currentTeam,
                    starPlayerId: userData.starPlayerId
                });
            }

            // Очищаем активные слоты для трансферов на следующий тур, сохраняя историю
            batch.update(userRef, {
                isLocked: false,
                currentTeam: [],
                starPlayerId: null,
                history: history // отправляем обновленный архив в Firebase
            });
        });

        await batch.commit();
        res.json({ success: true, message: "Тур официально завершен! Все составы успешно заархивированы в историю профилей, трансферное окно открыто." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Эндпоинт для админа: Установка времени дедлайна тура
app.post('/api/admin/set-deadline', async (req, res) => {
    const { secretKey, deadline } = req.body;
    if (secretKey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "Отказ" });

    try {
        await db.collection('settings').doc('tournament').set({ deadline }, { merge: true });
        res.json({ success: true, message: "Дедлайн тура успешно установлен!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Запуск приложения
//const PORT = process.env.PORT || 5000;
//app.listen(PORT, () => console.log(`🚀 Сервер запущен на http://localhost:${PORT}`));
module.exports = app;
