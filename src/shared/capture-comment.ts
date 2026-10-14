/** Count Unicode code points consistently in the field and at admission. */
export const COMMENT_MAX_LENGTH = 2000;
export const commentLength = (text: string) => Array.from(text).length;
export const isValidComment = (value: unknown): value is string => typeof value === "string"
  && commentLength(value) <= COMMENT_MAX_LENGTH && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  && !/[\ud800-\udfff]/u.test(value);
