/**
 * Transliteruje wartość do czystego ASCII (0x20-0x7E) i przycina brzegi.
 * Znaki, których nie da się złożyć (inne alfabety, emoji), są usuwane.
 */
export declare function asciiFold(value: string): string;
