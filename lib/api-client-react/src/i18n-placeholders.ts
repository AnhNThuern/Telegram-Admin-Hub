import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export const getI18nPlaceholdersQueryKey = () => ["/api/i18n/placeholders"] as const;

export const getI18nPlaceholders = (): Promise<Record<string, string[]>> =>
  customFetch<Record<string, string[]>>("/api/i18n/placeholders");

export function useGetI18nPlaceholders<TData = Record<string, string[]>>(
  options?: Omit<
    UseQueryOptions<Record<string, string[]>, unknown, TData, readonly [string]>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<Record<string, string[]>, unknown, TData, readonly [string]>({
    queryKey: getI18nPlaceholdersQueryKey(),
    queryFn: ({ signal }) => customFetch<Record<string, string[]>>("/api/i18n/placeholders", { signal }),
    ...options,
  });
}
