import { N_ } from '../platform/i18n.js';

const SEP = {};

export const TOOLBAR_GROUPS = [
    {
        id: 'select',
        items: [{ type: 'tool', id: 'select' }],
    },
    {
        id: 'annotate',
        items: [
            { type: 'tool', id: 'drag' },
            SEP,
            { type: 'tool', id: 'freehand' },
            { type: 'tool', id: 'rectangle' },
            { type: 'tool', id: 'solid-rectangle' },
            { type: 'tool', id: 'highlighter' },
            { type: 'tool', id: 'arrow' },
            { type: 'tool', id: 'text' },
            { type: 'tool', id: 'stamp' },
            { type: 'tool', id: 'blur' },
            SEP,
            {
                type: 'action',
                id: 'undo',
                icon: 'edit-undo-symbolic',
                signal: 'undo',
                tooltip: N_('Undo'),
            },
            {
                type: 'action',
                id: 'clear',
                icon: 'user-trash-symbolic',
                signal: 'clear',
                tooltip: N_('Clear all'),
            },
        ],
    },
    {
        id: 'utility',
        items: [
            {
                type: 'action',
                id: 'ocr',
                icon: 'scanner-symbolic',
                signal: 'ocr-trigger',
                tooltip: N_('Text Recognition'),
            },
        ],
    },
];

export { SEP };
