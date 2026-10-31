const crypto = require('node:crypto');
const { httpError } = require('./errors');

const FIELD_TYPES = ['text', 'textarea', 'email', 'date', 'single', 'multi'];
const CHOICE_TYPES = ['single', 'multi'];

const LIMITS = {
    title: 200,
    description: 2000,
    label: 300,
    option: 200,
    fields: 50,
    options: 30,
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function newId(prefix) {
    return prefix + crypto.randomBytes(6).toString('base64url');
}

function takeId(candidate, prefix, used) {
    const ok = typeof candidate === 'string' && ID_PATTERN.test(candidate) && !used.has(candidate);
    const id = ok ? candidate : newId(prefix);
    used.add(id);
    return id;
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function validateFormInput(body) {
    const input = body ?? {};
    const errors = [];

    const title = text(input.title);
    const description = text(input.description);

    if (!title) errors.push('Укажите название формы');
    if (title.length > LIMITS.title) errors.push(`Название длиннее ${LIMITS.title} символов`);
    if (description.length > LIMITS.description) errors.push(`Описание длиннее ${LIMITS.description} символов`);

    const rawFields = Array.isArray(input.fields) ? input.fields : [];
    if (rawFields.length > LIMITS.fields) errors.push(`Не больше ${LIMITS.fields} вопросов`);

    const fieldIds = new Set();
    const fields = rawFields.map((raw, index) => {
        const field = raw ?? {};
        const n = index + 1;
        const label = text(field.label);

        if (!FIELD_TYPES.includes(field.type)) errors.push(`Вопрос ${n}: неизвестный тип поля`);
        if (!label) errors.push(`Вопрос ${n}: введите текст вопроса`);
        if (label.length > LIMITS.label) errors.push(`Вопрос ${n}: текст длиннее ${LIMITS.label} символов`);

        const result = {
            id: takeId(field.id, 'f_', fieldIds),
            type: field.type,
            label,
            required: field.required === true,
        };

        if (CHOICE_TYPES.includes(field.type)) {
            result.options = validateOptions(field.options, n, errors);
        }

        return result;
    });

    if (errors.length) throw httpError(400, 'Форма не сохранена', errors);
    return { title, description, fields };
}

function validateOptions(rawOptions, n, errors) {
    const list = Array.isArray(rawOptions) ? rawOptions : [];
    const ids = new Set();
    const seen = new Set();

    if (list.length < 2) errors.push(`Вопрос ${n}: нужно минимум два варианта ответа`);
    if (list.length > LIMITS.options) errors.push(`Вопрос ${n}: не больше ${LIMITS.options} вариантов`);

    return list.map((raw, index) => {
        const label = text(raw?.label);
        const key = label.toLowerCase();

        if (!label) errors.push(`Вопрос ${n}, вариант ${index + 1}: пустой текст`);
        else if (seen.has(key)) errors.push(`Вопрос ${n}: вариант «${label}» повторяется`);
        if (label.length > LIMITS.option) errors.push(`Вопрос ${n}, вариант ${index + 1}: слишком длинный`);
        seen.add(key);

        return { id: takeId(raw?.id, 'o_', ids), label };
    });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ANSWER_LIMITS = {
    text: 500,
    textarea: 5000,
    email: 254,
};

function isRealDate(value) {
    if (!DATE_PATTERN.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function checkTextAnswer(field, rawValue) {
    const value = text(rawValue);

    if (!value) return { value, error: field.required ? 'Обязательное поле' : null };

    const max = ANSWER_LIMITS[field.type];
    if (max && value.length > max) return { value, error: `Не больше ${max} символов` };
    if (field.type === 'email' && !EMAIL_PATTERN.test(value)) return { value, error: 'Проверьте формат email' };
    if (field.type === 'date' && !isRealDate(value)) return { value, error: 'Укажите корректную дату' };

    return { value, error: null };
}

function checkChoiceAnswer(field, rawValue) {
    let ids = [];
    if (field.type === 'single' && typeof rawValue === 'string' && rawValue) ids = [rawValue];
    if (field.type === 'multi' && Array.isArray(rawValue)) ids = [...new Set(rawValue)];

    const chosen = field.options.filter((option) => ids.includes(option.id));
    const value = chosen.map((option) => option.label);

    if (chosen.length !== ids.length) {
        return { value, error: 'Выбранный вариант больше недоступен, выберите снова' };
    }
    if (field.required && value.length === 0) {
        return { value, error: 'Выберите вариант' };
    }
    return { value, error: null };
}

function validateAnswers(form, body) {
    const input = body ?? {};
    const rawAnswers = input.answers && typeof input.answers === 'object' ? input.answers : {};
    const errors = {};

    const answers = form.fields.map((field) => {
        const check = CHOICE_TYPES.includes(field.type) ? checkChoiceAnswer : checkTextAnswer;
        const { value, error } = check(field, rawAnswers[field.id]);
        if (error) errors[field.id] = error;
        return { fieldId: field.id, label: field.label, type: field.type, value };
    });

    if (input.consent !== true) errors.consent = 'Нужно согласие на обработку персональных данных';

    if (Object.keys(errors).length) throw httpError(400, 'Проверьте ответы', errors);
    return answers;
}

module.exports = { validateFormInput, validateAnswers, FIELD_TYPES, CHOICE_TYPES, LIMITS };
