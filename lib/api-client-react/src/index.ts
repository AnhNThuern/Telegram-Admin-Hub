export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter, ApiError } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

export { useGetI18nPlaceholders, getI18nPlaceholders, getI18nPlaceholdersQueryKey } from "./i18n-placeholders";
