const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = DB_FILE + '.tmp';

function emptyDb() {
    return { forms: [], responses: [], sessions: [] };
}

function load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) return emptyDb();

    const raw = fs.readFileSync(DB_FILE, 'utf8');
    try {
        return { ...emptyDb(), ...JSON.parse(raw) };
    } catch (err) {
        throw new Error(`Файл ${DB_FILE} повреждён, сервер не запущен: ${err.message}`);
    }
}

const db = load();

function save() {
    fs.writeFileSync(TMP_FILE, JSON.stringify(db, null, 2));
    fs.renameSync(TMP_FILE, DB_FILE);
}

function update(change) {
    const result = change(db);
    save();
    return result;
}

module.exports = { db, update };
