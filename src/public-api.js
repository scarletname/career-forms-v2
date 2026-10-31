const crypto = require('node:crypto');
const express = require('express');
const { db, update } = require('./storage');
const { validateAnswers } = require('./validation');
const { httpError } = require('./errors');

const router = express.Router();

const SESSION_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const EVENT_TYPES = ['open', 'start', 'field'];

function findPublicForm(id) {
    const form = db.forms.find((f) => f.id === id && f.status !== 'draft');
    if (!form) throw httpError(404, 'Форма не найдена');
    return form;
}

function readSessionId(body) {
    const id = body?.sessionId;
    return typeof id === 'string' && SESSION_PATTERN.test(id) ? id : null;
}

function getSession(data, formId, sessionId, now) {
    let session = data.sessions.find((s) => s.formId === formId && s.sessionId === sessionId);
    if (!session) {
        session = { formId, sessionId, openedAt: now, startedAt: null, lastFieldId: null, submittedAt: null };
        data.sessions.push(session);
    }
    return session;
}

router.get('/forms/:id', (req, res) => {
    const form = findPublicForm(req.params.id);
    res.json({
        id: form.id,
        title: form.title,
        description: form.description,
        status: form.status,
        fields: form.fields,
    });
});

router.post('/forms/:id/events', (req, res) => {
    const form = findPublicForm(req.params.id);
    const sessionId = readSessionId(req.body);
    const type = req.body?.type;
    const fieldId = req.body?.fieldId;

    if (!sessionId || !EVENT_TYPES.includes(type)) throw httpError(400, 'Некорректное событие');
    if (type === 'field' && !form.fields.some((f) => f.id === fieldId)) throw httpError(400, 'Неизвестное поле');

    if (form.status === 'published') {
        update((data) => {
            const now = new Date().toISOString();
            const session = getSession(data, form.id, sessionId, now);
            if (type !== 'open') session.startedAt ??= now;
            if (type === 'field') session.lastFieldId = fieldId;
        });
    }
    res.status(204).end();
});

router.post('/forms/:id/responses', (req, res) => {
    const form = findPublicForm(req.params.id);
    if (form.status === 'closed') throw httpError(409, 'Приём заявок по этой форме закрыт');

    const answers = validateAnswers(form, req.body);
    const sessionId = readSessionId(req.body);
    const now = new Date().toISOString();

    const response = {
        id: 'r_' + crypto.randomBytes(8).toString('base64url'),
        formId: form.id,
        submittedAt: now,
        consentAt: now,
        answers,
    };

    update((data) => {
        data.responses.push(response);
        if (sessionId) {
            const session = getSession(data, form.id, sessionId, now);
            session.startedAt ??= now;
            session.submittedAt = now;
        }
    });
    res.status(201).json({ id: response.id });
});

module.exports = router;
