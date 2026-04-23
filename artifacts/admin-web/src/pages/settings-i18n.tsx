import { useState, useMemo } from "react";
import { useListI18nStrings, useBulkUpdateI18nStrings, useFlushI18nCache, getListI18nStringsQueryKey, useGetI18nPlaceholders } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Save, RotateCcw, Zap, Eye, EyeOff } from "lucide-react";

type LangTab = "vi" | "en";

type EditMap = Record<string, { vi: string; en: string }>;

const SAMPLE_VALUES: Record<string, string> = {
  name: "Nguyễn Văn A",
  shop: "TechShop",
  code: "ORD-12345",
  amount: "150.000",
  balance: "500.000",
  price: "99.000",
  min: "1",
  max: "10",
  n: "5",
  product: "iPhone 15",
  qty: "2",
  status: "đã thanh toán",
};

function renderPreview(template: string): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return SAMPLE_VALUES[key] !== undefined ? SAMPLE_VALUES[key] : `{${key}}`;
  });
}

function hasPlaceholders(value: string): boolean {
  return /\{(\w+)\}/.test(value);
}

export default function SettingsI18n() {
  const { data, isLoading } = useListI18nStrings();
  const { data: placeholderMap = {} } = useGetI18nPlaceholders();
  const bulkUpdate = useBulkUpdateI18nStrings();
  const flushCache = useFlushI18nCache();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<LangTab>("vi");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<EditMap>({});
  const [previewKeys, setPreviewKeys] = useState<Set<string>>(new Set());

  const strings = data?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return strings;
    return strings.filter(
      s =>
        s.key.toLowerCase().includes(q) ||
        s.vi.toLowerCase().includes(q) ||
        s.en.toLowerCase().includes(q)
    );
  }, [strings, search]);

  const getValue = (key: string, lang: LangTab): string => {
    if (edits[key]?.[lang] !== undefined) return edits[key][lang];
    const row = strings.find(s => s.key === key);
    return row ? row[lang] : "";
  };

  const handleChange = (key: string, lang: LangTab, value: string) => {
    setEdits(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? { vi: getValue(key, "vi"), en: getValue(key, "en") }), [lang]: value },
    }));
  };

  const togglePreview = (key: string) => {
    setPreviewKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dirtyKeys = Object.keys(edits);

  const handleSave = () => {
    const updates = dirtyKeys.map(key => ({
      key,
      vi: edits[key].vi,
      en: edits[key].en,
    }));
    bulkUpdate.mutate(
      { data: { updates } },
      {
        onSuccess: () => {
          toast({ title: "Đã lưu thành công", description: `Cập nhật ${updates.length} chuỗi ngôn ngữ.` });
          setEdits({});
          queryClient.invalidateQueries({ queryKey: getListI18nStringsQueryKey() });
          flushCache.mutate(undefined, {
            onError: () => {
              console.warn("Auto-flush cache after save failed; bot strings may be stale until manual flush.");
            },
          });
        },
        onError: () => {
          toast({ title: "Lỗi", description: "Không thể lưu. Vui lòng thử lại.", variant: "destructive" });
        },
      }
    );
  };

  const handleFlushCache = () => {
    flushCache.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Cache đã được xoá", description: "Bot sẽ dùng các chuỗi mới nhất ngay lập tức." });
      },
      onError: () => {
        toast({ title: "Lỗi", description: "Không thể xoá cache. Vui lòng thử lại.", variant: "destructive" });
      },
    });
  };

  const handleDiscard = () => setEdits({});

  const groupedKeys = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const s of filtered) {
      const prefix = s.key.split(".")[0];
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(s);
    }
    return groups;
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Chuỗi ngôn ngữ (i18n)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Chỉnh sửa nội dung bot bằng Tiếng Việt và Tiếng Anh.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleFlushCache}
            disabled={flushCache.isPending}
            title="Xoá cache để bot dùng các chuỗi mới nhất ngay lập tức"
          >
            {flushCache.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            Flush Cache
          </Button>
          {dirtyKeys.length > 0 && (
            <>
              <Badge variant="secondary">{dirtyKeys.length} thay đổi</Badge>
              <Button variant="ghost" size="sm" onClick={handleDiscard} disabled={bulkUpdate.isPending}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Huỷ
              </Button>
              <Button size="sm" onClick={handleSave} disabled={bulkUpdate.isPending}>
                {bulkUpdate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Lưu tất cả
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Tìm kiếm theo key hoặc nội dung..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex rounded-md border border-border overflow-hidden">
          {(["vi", "en"] as LangTab[]).map(l => (
            <button
              key={l}
              onClick={() => setTab(l)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === l
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {l === "vi" ? "🇻🇳 Tiếng Việt" : "🇬🇧 English"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {Object.entries(groupedKeys).map(([prefix, rows]) => (
          <div key={prefix} className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 bg-muted/30 border-b border-border">
              <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                {prefix}
              </span>
            </div>
            <div className="divide-y divide-border">
              {rows.map(s => {
                const isDirty = !!edits[s.key];
                const currentValue = getValue(s.key, tab);
                const showPreview = previewKeys.has(s.key);
                const canPreview = hasPlaceholders(currentValue);
                return (
                  <div key={s.key} className="flex items-start gap-4 px-4 py-3">
                    <div className="w-56 shrink-0 pt-1">
                      <code className="text-xs text-muted-foreground font-mono">{s.key}</code>
                      {isDirty && (
                        <Badge variant="outline" className="ml-2 text-[10px] py-0 px-1 border-yellow-500 text-yellow-500">
                          edited
                        </Badge>
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-start gap-2">
                        <textarea
                          className="flex-1 text-sm bg-background border border-input rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[2.5rem] font-mono"
                          rows={currentValue.split("\n").length}
                          value={currentValue}
                          onChange={e => handleChange(s.key, tab, e.target.value)}
                        />
                        {canPreview && (
                          <button
                            type="button"
                            onClick={() => togglePreview(s.key)}
                            className="mt-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title={showPreview ? "Ẩn xem trước" : "Xem trước với dữ liệu mẫu"}
                          >
                            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                      {placeholderMap[s.key] && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {placeholderMap[s.key].map(token => (
                            <span
                              key={token}
                              className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-mono font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                            >
                              {`{${token}}`}
                            </span>
                          ))}
                        </div>
                      )}
                      {showPreview && canPreview && (
                        <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-foreground whitespace-pre-wrap">
                          {renderPreview(currentValue)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {dirtyKeys.length > 0 && (
        <div className="sticky bottom-4 flex justify-end gap-2">
          <Button variant="outline" onClick={handleDiscard} disabled={bulkUpdate.isPending}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Huỷ thay đổi
          </Button>
          <Button onClick={handleSave} disabled={bulkUpdate.isPending}>
            {bulkUpdate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Lưu {dirtyKeys.length} thay đổi
          </Button>
        </div>
      )}
    </div>
  );
}
