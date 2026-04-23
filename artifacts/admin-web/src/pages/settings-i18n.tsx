import { useState, useMemo } from "react";
import { useListI18nStrings, useBulkUpdateI18nStrings, getListI18nStringsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Save, RotateCcw } from "lucide-react";

type LangTab = "vi" | "en";

type EditMap = Record<string, { vi: string; en: string }>;

export default function SettingsI18n() {
  const { data, isLoading } = useListI18nStrings();
  const bulkUpdate = useBulkUpdateI18nStrings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<LangTab>("vi");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<EditMap>({});

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

  const dirtyKeys = Object.keys(edits);

  const handleSave = () => {
    const updates = dirtyKeys.map(key => ({
      key,
      vi: edits[key].vi,
      en: edits[key].en,
    }));
    bulkUpdate.mutate(
      { updates },
      {
        onSuccess: () => {
          toast({ title: "Đã lưu thành công", description: `Cập nhật ${updates.length} chuỗi ngôn ngữ.` });
          setEdits({});
          queryClient.invalidateQueries({ queryKey: getListI18nStringsQueryKey() });
        },
        onError: () => {
          toast({ title: "Lỗi", description: "Không thể lưu. Vui lòng thử lại.", variant: "destructive" });
        },
      }
    );
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
                    <div className="flex-1">
                      <textarea
                        className="w-full text-sm bg-background border border-input rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[2.5rem] font-mono"
                        rows={currentValue.split("\n").length}
                        value={currentValue}
                        onChange={e => handleChange(s.key, tab, e.target.value)}
                      />
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
