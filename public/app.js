const PLAYERS = [
    { id: 1, name: 'apEx', team: 'Vitality', role: 'Капитан', rating: 0.99, img: 'img/apex.jpg', logo: 'img/logo/vitality.png' },
    { id: 2, name: 'ropz', team: 'Vitality', role: 'Рифлер', rating: 1.18, img: 'img/ropz.jpg', logo: 'img/logo/vitality.png' },
    { id: 3, name: 'ZywOo', team: 'Vitality', role: 'Снайпер', rating: 1.37, img: 'img/zywoo.jpg', logo: 'img/logo/vitality.png' },
    { id: 4, name: 'flameZ', team: 'Vitality', role: 'Рифлер', rating: 1.18, img: 'img/flamez.jpg', logo: 'img/logo/vitality.png' },
    { id: 5, name: 'mezii', team: 'Vitality', role: 'Рифлер', rating: 1.05, img: 'img/mezii.jpg', logo: 'img/logo/vitality.png' },
    { id: 6, name: 'Aleksib', team: 'Natus Vincere', role: 'Капитан', rating: 0.91, img: 'img/aleksib.jpg', logo: 'img/logo/navi.png' },
    { id: 7, name: 'iM', team: 'Natus Vincere', role: 'Рифлер', rating: 1.08, img: 'img/im.jpg', logo: 'img/logo/navi.png' },
    { id: 8, name: 'b1t', team: 'Natus Vincere', role: 'Рифлер', rating: 1.12, img: 'img/b1t.jpg', logo: 'img/logo/navi.png' },
    { id: 9, name: 'w0nderful', team: 'Natus Vincere', role: 'Снайпер', rating: 1.18, img: 'img/wonderful.jpg', logo: 'img/logo/navi.png' },
    { id: 10, name: 'makazze', team: 'Natus Vincere', role: 'Рифлер', rating: 1.21, img: 'img/makazze.jpg', logo: 'img/logo/navi.png' },
    { id: 11, name: 'sh1ro', team: 'Spirit', role: 'Снайпер', rating: 1.14, img: 'img/sh1ro.jpg', logo: 'img/logo/spirit.png' },
    { id: 12, name: 'magixx', team: 'Spirit', role: 'Капитан', rating: 1.02, img: 'img/magixx.jpg', logo: 'img/logo/spirit.png' },
    { id: 13, name: 'tN1R', team: 'Spirit', role: 'Рифлер', rating: 1.04, img: 'img/tn1r.jpg', logo: 'img/logo/spirit.png' },
    { id: 14, name: 'zont1x', team: 'Spirit', role: 'Рифлер', rating: 0.95, img: 'img/zont1x.jpg', logo: 'img/logo/spirit.png' },
    { id: 15, name: 'donk', team: 'Spirit', role: 'Рифлер', rating: 1.41, img: 'img/donk.jpg', logo: 'img/logo/spirit.png' }
];

let state = {
    myTeam: [
        { slotRole: 'Капитан', player: null },
        { slotRole: 'Рифлер', player: null },
        { slotRole: 'Рифлер', player: null },
        { slotRole: 'Рифлер', player: null },
        { slotRole: 'Снайпер', player: null }
    ],
    starPlayerIndex: null,
    score: 0,
    isLocked: false
};

const marketGrid = document.getElementById('market-grid');
const teamSlotsContainer = document.getElementById('team-slots');
const scoreEl = document.getElementById('score');
const teamCountEl = document.getElementById('team-count');

// Главная функция инициализации приложения
async function init() {
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const response = await fetch('/api/get-profile', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error(`Ошибка сервера: ${response.status}`);

            const data = await response.json();
            if (data && data.success) {
                state.score = data.data.score || 0;
                state.isLocked = data.data.isLocked || false;

                // Восстановление состава
                if (data.data.currentTeam && data.data.currentTeam.length > 0) {
                    data.data.currentTeam.forEach((id, idx) => {
                        const foundPlayer = PLAYERS.find(p => p.id === id);
                        if (foundPlayer && idx < state.myTeam.length) {
                            state.myTeam[idx].player = foundPlayer;
                        }
                    });
                    if (data.data.starPlayerId) {
                        const starIdx = data.data.currentTeam.indexOf(data.data.starPlayerId);
                        if (starIdx !== -1) state.starPlayerIndex = starIdx;
                    }
                }

                // 🔥 ЗАПУСК АВТОМАТИЧЕСКОГО ТАЙМЕРА ДЕДЛАЙНА
                if (data.data.deadline) {
                    startDeadlineCountdown(data.data.deadline);
                } else {
                    const timerEl = document.getElementById('countdown-timer');
                    if (timerEl) timerEl.textContent = "Время не установлено";
                }
            }
        } catch (err) {
            console.error("Ошибка загрузки профиля с сервера:", err);
        }
    }

    if (scoreEl) scoreEl.textContent = state.score.toString();

    renderTeam();
    renderMarket();
    if (typeof loadHLTVTeamRankings === 'function') {
        loadHLTVTeamRankings();
    }
    const loader = document.getElementById('site-loader');
    if (loader) {
        loader.style.opacity = '0';
        loader.style.visibility = 'hidden';
    }
}


// Функция подсчета лимита игроков из одного реального клуба
function getTeamCountInFantasy(teamName) {
    return state.myTeam.filter(slot => slot.player && slot.player.team === teamName).length;
}

// Рендеринг витрины доступных игроков на рынке
function renderMarket() {
    if (!marketGrid) return;
    marketGrid.innerHTML = '';

    PLAYERS.forEach(player => {
        const isBought = state.myTeam.some(slot => slot.player && slot.player.id === player.id);
        const countFromThisTeam = getTeamCountInFantasy(player.team);
        const limitReached = countFromThisTeam >= 2;

        let btnText = 'В команду';
        let disabledAttr = '';

        // Если состав заблокирован, отключаем весь рынок трансферов
        if (state.isLocked) {
            disabledAttr = 'disabled';
        } else if (isBought) {
            btnText = 'В команде';
            disabledAttr = 'disabled';
        } else if (limitReached) {
            btnText = "Лимит " + player.team + " (max 2)";
            disabledAttr = 'disabled';
        }

        const card = document.createElement('div');
        card.className = 'player-card';
        card.innerHTML = `
            <img src="${player.img}" alt="${player.name}" class="player-card__bg-avatar" onerror="this.src='https://placehold.co{encodeURIComponent(player.name)}'">
            <div class="player-card__badge">
                <img src="${player.logo}" alt="${player.team}" class="player-card__bg-logo" onerror="this.style.display='none'">
                <div class="player-card__name">${player.name}</div>
                <div class="player-card__team">${player.team} <span class="player-card__role-tag">${player.role}</span></div>
                <div class="player-card__badge-rating">RATING 3.0 <span>${player.rating}</span></div>
                <button class="btn btn--buy" ${disabledAttr} onclick="buyPlayer(${player.id})">${btnText}</button>
            </div>
        `;
        marketGrid.appendChild(card);
    });
}

// Рендеринг 5 слотов вашей активной сборной
function renderTeam() {
    if (!teamSlotsContainer) return;
    teamSlotsContainer.innerHTML = '';
    let currentTeamSize = 0;

    state.myTeam.forEach((slot, index) => {
        const player = slot.player;
        const slotEl = document.createElement('div');
        slotEl.className = 'slot';
        slotEl.setAttribute('data-role', slot.slotRole);

        if (player) {
            currentTeamSize++;
            const isStar = state.starPlayerIndex === index;
            const disabledState = state.isLocked ? 'disabled' : '';

            slotEl.innerHTML = `
                <div class="player-card ${isStar ? 'player-card--star' : ''}">
                    <img src="${player.img}" alt="${player.name}" class="player-card__bg-avatar" onerror="this.src='https://placehold.co{encodeURIComponent(player.name)}'">
                    <div class="player-card__badge">
                        <img src="${player.logo}" alt="${player.team}" class="player-card__bg-logo">
                        <div class="player-card__name">${player.name} ${isStar ? '⭐' : ''}</div>
                        <div class="player-card__team">${player.team} <span class="player-card__role-tag">${player.role}</span></div>
                        <div class="star-toggle-container">
                            <label class="star-label">
                                <input type="radio" name="star-player" ${isStar ? 'checked' : ''} ${disabledState} onchange="setStarPlayer(${index})"> Звездный игрок
                            </label>
                        </div>
                        <button class="btn btn--remove" ${disabledState} onclick="removePlayer(${index})">Убрать</button>
                    </div>
                </div>
            `;
        } else {
            slotEl.innerHTML = `<div class="slot__empty">Выбрать ${slot.slotRole}</div>`;
        }
        teamSlotsContainer.appendChild(slotEl);
    });

    if (teamCountEl) teamCountEl.textContent = currentTeamSize.toString();

    if (calculateBtn && !state.isLocked) {
        calculateBtn.disabled = (currentTeamSize !== 5 || state.starPlayerIndex === null);
    }
}
window.buyPlayer = function (id) {
    if (state.isLocked) return;
    const player = PLAYERS.find(p => p.id === id);
    if (!player) return;

    if (getTeamCountInFantasy(player.team) >= 2) {
        alert("Нельзя брать больше 2 игроков из организации " + player.team + "!");
        return;
    }

    let targetIndex = state.myTeam.findIndex(slot => slot.slotRole === player.role && !slot.player);

    if (targetIndex !== -1) {
        state.myTeam[targetIndex].player = player;
        renderTeam();
        renderMarket();
        autoSaveTeamToServer();
    } else {
        alert(`Ошибка! Слот для роли "${player.role}" уже заполнен.`);
    }
};

window.removePlayer = function (index) {
    if (state.isLocked) return;
    if (state.myTeam[index].player) {
        state.myTeam[index].player = null;
        if (state.starPlayerIndex === index) state.starPlayerIndex = null;
        renderTeam();
        renderMarket();
        autoSaveTeamToServer(); // 🔥 Автосохранение в облако
    }
};

window.setStarPlayer = function (index) {
    if (state.isLocked) return;
    state.starPlayerIndex = index;
    renderTeam();
    autoSaveTeamToServer(); // 🔥 Автосохранение в облако
};

// Функция автоматического сохранения состава в облако при любых изменениях
function autoSaveTeamToServer() {
    if (state.isLocked) return; // Если дедлайн прошел, сохранение заблокировано

    const teamIds = state.myTeam.map(slot => slot.player ? slot.player.id : null);
    const starPlayerId = state.myTeam[state.starPlayerIndex]?.player?.id || null;

    const token = localStorage.getItem('token');
    if (!token) return;

    // Отправляем текущее состояние состава на бэкенд
    fetch('/api/lock-team', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ teamIds, starPlayerId })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                console.log("Состав успешно автосохранен на сервере.");
            }
        })
        .catch(err => console.error("Ошибка автосохранения состава:", err));
}

// Автоисправление картинок
document.addEventListener("DOMContentLoaded", () => {
    document.body.addEventListener("error", (e) => {
        if (e.target.tagName === "IMG" && e.target.classList.contains("player-card__bg-avatar")) {
            const name = e.target.alt || "Player";
            e.target.src = "https://placehold.co" + encodeURIComponent(name);
        }
    }, true);
});

// Автономный вывод бегущей строки (с бесшовным дублированием массива)
function loadHLTVTeamRankings() {
    const rankingContainer = document.getElementById('ranking-list');
    if (!rankingContainer) return;

    const localTeams = [
        { name: 'Vitality', points: 1000 }, { name: 'Natus Vincere', points: 709 }, { name: 'Spirit', points: 517 },
        { name: 'Falcons', points: 508 }, { name: 'FURIA', points: 398 }, { name: 'Aurora', points: 346 },
        { name: 'MOUZ', points: 302 }, { name: 'The MongolZ', points: 298 }, { name: 'Legacy', points: 296 },
        { name: 'PARIVISION', points: 260 }, { name: 'GamerLegion', points: 258 }, { name: 'Astralis', points: 251 },
        { name: 'G2', points: 223 }, { name: 'FUT', points: 222 }, { name: 'B8', points: 171 },
        { name: 'FaZe', points: 150 }, { name: 'BetBoom', points: 136 }, { name: 'paiN', points: 133 },
        { name: '3DMAX', points: 127 }, { name: 'MIBR', points: 126 }
    ];

    rankingContainer.innerHTML = '';

    function createCard(team, idx) {
        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.innerHTML = `
            <span class="ranking-item__place">#${idx + 1}</span>
            <span class="ranking-item__name">${team.name}</span>
            <span class="ranking-item__points">${team.points}</span>
        `;
        return item;
    }

    localTeams.forEach((team, index) => rankingContainer.appendChild(createCard(team, index)));
    localTeams.forEach((team, index) => rankingContainer.appendChild(createCard(team, index)));
}

function startDeadlineCountdown(deadlineString) {
    const timerEl = document.getElementById('countdown-timer');
    if (!timerEl) return;

    const deadlineDate = new Date(deadlineString);

    function updateTimer() {
        const now = new Date();
        const diff = deadlineDate - now;

        if (diff <= 0) {
            timerEl.textContent = "ТРАНСФЕРЫ ЗАКРЫТЫ 🛑";
            timerEl.style.color = "var(--color-danger)";
            timerEl.style.background = "rgba(255, 74, 74, 0.1)";

            if (!state.isLocked) {
                state.isLocked = true;
                renderTeam();
                renderMarket();
            }
            clearInterval(timerInterval);
            return;
        }

        // Вычисляем часы, минуты и секунды
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        // Красивое форматирование двузначных чисел (01:05:09)
        const fH = hours.toString().padStart(2, '0');
        const fM = minutes.toString().padStart(2, '0');
        const fS = seconds.toString().padStart(2, '0');

        timerEl.textContent = `ДО СТАРТА: ${fH}:${fM}:${fS}`;
    }

    // Запускаем ежесекундный интервал
    updateTimer();
    const timerInterval = setInterval(updateTimer, 1000);
}

// Запуск приложения
init();

// Логика сворачивания и разворачивания мобильной шапки
document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("toggle-stats-btn");
    const statsWrapper = document.getElementById("mobile-stats-wrapper");

    if (toggleBtn && statsWrapper) {
        toggleBtn.addEventListener("click", () => {
            // Переключаем класс collapsed у обертки плашек
            statsWrapper.classList.toggle("collapsed");

            // Меняем стрелочку в зависимости от состояния
            if (statsWrapper.classList.contains("collapsed")) {
                toggleBtn.textContent = "▼";
                toggleBtn.style.color = "var(--color-text-muted)";
            } else {
                toggleBtn.textContent = "▲";
                toggleBtn.style.color = "var(--color-primary)";
            }
        });
    }
});

