const path = require('node:path');
const express = require('express');
const api = require('./src/api');
const publicApi = require('./src/public-api');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json({ limit: '100kb' }));

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get('/f/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'form', 'index.html')));

app.use('/api/public', publicApi);
app.use('/api', api);
app.use(express.static(PUBLIC_DIR));

app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);

    res.status(status).json({
        error: status >= 500 ? 'Внутренняя ошибка сервера' : err.message,
        details: err.details,
    });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}/admin`);
});
