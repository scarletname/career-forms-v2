const crypto = require('node:crypto');
const express = require('express');
const { db, update } = require('./storage');
const { validateFormInput } = require('./validation');
const { httpError } = require('./errors');

const router = express.Router();

const STATUS_TRANSITIONS = {
    draft: ['published'],
    published: ['closed'],
    closed: ['published'],
};

function findForm(id) {
    const form = db.forms.find((f) => f.id === id);
    if (!form) throw httpError(404, 'Форма не найдена');
    return form;
}

router.get('/health', (req, res) => res.json({ ok: true }));

router.get('/forms', (req, res) => {
    const list = db.forms
        .map((form) => ({
            id: form.id,
            title: form.title,
            status: form.status,
            updatedAt: form.updatedAt,
            fieldsCount: form.fields.length,
            responsesCount: db.responses.filter((r) => r.formId === form.id).length,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(list);
});

router.post('/forms', (req, res) => {
    const now = new Date().toISOString();
    const form = {
        id: crypto.randomBytes(8).toString('base64url'),
        title: 'Новая форма',
        description: '',
        status: 'draft',
        fields: [],
        createdAt: now,
        updatedAt: now,
    };
    update((data) => data.forms.push(form));
    res.status(201).json(form);
});

router.get('/forms/:id', (req, res) => {
    res.json(findForm(req.params.id));
});

router.put('/forms/:id', (req, res) => {
    const form = findForm(req.params.id);
    const input = validateFormInput(req.body);

    if (form.status !== 'draft' && input.fields.length === 0) {
        throw httpError(400, 'В опубликованной форме должен остаться хотя бы один вопрос');
    }

    update(() => {
        Object.assign(form, input, { updatedAt: new Date().toISOString() });
    });
    res.json(form);
});

router.post('/forms/:id/status', (req, res) => {
    const form = findForm(req.params.id);
    const next = req.body?.status;

    if (!STATUS_TRANSITIONS[form.status].includes(next)) {
        throw httpError(400, 'Недопустимая смена статуса');
    }
    if (next === 'published' && form.fields.length === 0) {
        throw httpError(400, 'Добавьте хотя бы один вопрос перед публикацией');
    }

    update(() => {
        form.status = next;
        form.updatedAt = new Date().toISOString();
    });
    res.json(form);
});

module.exports = router;
