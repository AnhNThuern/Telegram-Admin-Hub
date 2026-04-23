import { useGetBotConfig, useSaveBotConfig, useTestBotToken, useSetBotWebhook, useDisconnectBot, useRegisterBotCommands, getGetBotConfigQueryKey } from "@workspace/api-client-react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Bot, Unplug, Plug, Activity, Eye, EyeOff, Play, Square, Keyboard, Store, Terminal } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const botSchema = z.object({
  botToken: z.string().min(1, "Bot token là bắt buộc"),
  adminChatId: z.string()
    .optional()
    .refine(
      (v) => !v || /^-?\d+$/.test(v),
      "Chat ID chỉ gồm chữ số (có thể bắt đầu bằng dấu - cho nhóm/channel)"
    ),
});

type BotFormValues = z.infer<typeof botSchema>;

const menuTextsSchema = z.object({
  warrantyText: z.string().max(4000, "Tối đa 4000 ký tự").optional(),
  supportText: z.string().max(4000, "Tối đa 4000 ký tự").optional(),
  infoText: z.string().max(4000, "Tối đa 4000 ký tự").optional(),
});

type MenuTextsValues = z.infer<typeof menuTextsSchema>;

const welcomeSchema = z.object({
  shopName: z.string().max(100, "Tối đa 100 ký tự").optional(),
  welcomeMessage: z.string().max(1000, "Tối đa 1000 ký tự").optional(),
});

type WelcomeValues = z.infer<typeof welcomeSchema>;

export default function SettingsBot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showToken, setShowToken] = useState(false);
  
  const { data: config, isLoading } = useGetBotConfig({
    query: { queryKey: getGetBotConfigQueryKey() }
  });

  const saveBotTokenConfig = useSaveBotConfig();
  const saveShopInfoConfig = useSaveBotConfig();
  const saveMenuTextsConfig = useSaveBotConfig();
  const testToken = useTestBotToken();
  const setWebhook = useSetBotWebhook();
  const disconnectBot = useDisconnectBot();
  const registerCommands = useRegisterBotCommands();

  const form = useForm<BotFormValues>({
    resolver: zodResolver(botSchema),
    defaultValues: {
      botToken: "",
      adminChatId: "",
    },
  });

  const menuTextsForm = useForm<MenuTextsValues>({
    resolver: zodResolver(menuTextsSchema),
    defaultValues: {
      warrantyText: "",
      supportText: "",
      infoText: "",
    },
  });

  const welcomeForm = useForm<WelcomeValues>({
    resolver: zodResolver(welcomeSchema),
    defaultValues: {
      shopName: "",
      welcomeMessage: "",
    },
  });

  const watchedShopName = welcomeForm.watch("shopName");
  const watchedWelcomeMessage = welcomeForm.watch("welcomeMessage");
  const welcomeMessageLength = (watchedWelcomeMessage ?? "").length;

  // Escape HTML special chars to prevent stored XSS when rendering admin-typed
  // content via dangerouslySetInnerHTML. Applied to the raw input BEFORE any
  // Markdown conversion, so <script> etc. never execute in the browser.
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Convert Markdown bold/italic to HTML for the live preview panel.
  // Must be called on already-HTML-escaped input.
  const mdToHtmlPreview = (escaped: string): string =>
    escaped
      .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
      .replace(/__(.+?)__/gs, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>")
      .replace(/(?<!_)_([^_\n]+?)_(?!_)/g, "<em>$1</em>")
      .replace(/\n/g, "<br/>");

  // Build a live preview of the welcome message (applies same transforms as the bot)
  const welcomePreviewHtml = (() => {
    const name = "<strong>Nguyễn Văn A</strong>";
    const shop = `<strong>${escapeHtml(watchedShopName?.trim() || "cửa hàng")}</strong>`;
    if (watchedWelcomeMessage?.trim()) {
      // 1. Escape the raw admin input (prevents XSS)
      // 2. Substitute safe pre-composed HTML for our known placeholders
      // 3. Convert remaining Markdown patterns to HTML tags
      const safe = escapeHtml(watchedWelcomeMessage)
        .replace(/\{name\}/g, name)
        .replace(/\{shop_name\}/g, shop);
      return mdToHtmlPreview(safe);
    }
    return `👋 Chào mừng ${name} đến với ${shop}!<br/><br/>Chọn tùy chọn bên dưới:`;
  })();

  useEffect(() => {
    if (config) {
      form.reset({
        botToken: config.botToken || "",
        adminChatId: config.adminChatId || "",
      });
      menuTextsForm.reset({
        warrantyText: config.warrantyText || "",
        supportText: config.supportText || "",
        infoText: config.infoText || "",
      });
      welcomeForm.reset({
        shopName: config.shopName || "",
        welcomeMessage: config.welcomeMessage || "",
      });
    }
  }, [config, form, menuTextsForm, welcomeForm]);

  const getApiErrorMessage = (err: unknown): string => {
    if (err && typeof err === "object") {
      const e = err as { data?: { error?: string }; message?: string };
      if (e.data?.error) return e.data.error;
      if (e.message) return e.message;
    }
    return "Đã xảy ra lỗi không xác định";
  };

  const onSubmit = (data: BotFormValues) => {
    saveBotTokenConfig.mutate(
      { data: { botToken: data.botToken, adminChatId: data.adminChatId || null } },
      {
        onSuccess: () => {
          toast({ title: "Đã lưu cấu hình Bot" });
          queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Lưu thất bại", description: getApiErrorMessage(err) });
        },
      }
    );
  };

  const onSaveWelcome = (data: WelcomeValues) => {
    saveShopInfoConfig.mutate(
      {
        data: {
          botToken: config?.botToken || "",
          shopName: data.shopName ?? "",
          welcomeMessage: data.welcomeMessage ?? "",
        },
      },
      {
        onSuccess: (res) => {
          toast({ title: "Đã lưu thông tin cửa hàng" });
          // Update cache directly so only this form resets — don't trigger a
          // full refetch which would also reset the menu-text form mid-edit.
          queryClient.setQueryData(getGetBotConfigQueryKey(), (old: typeof config) => ({
            ...old,
            shopName: res.shopName,
            welcomeMessage: res.welcomeMessage,
          }));
          welcomeForm.reset({ shopName: res.shopName ?? "", welcomeMessage: res.welcomeMessage ?? "" });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Lưu thất bại", description: getApiErrorMessage(err) });
        },
      },
    );
  };

  const onSaveMenuTexts = (data: MenuTextsValues) => {
    // Send the existing (masked) bot token back unchanged — the API treats a
    // masked token as "no change" and only updates the menu text fields.
    saveMenuTextsConfig.mutate(
      {
        data: {
          botToken: config?.botToken || "",
          warrantyText: data.warrantyText ?? "",
          supportText: data.supportText ?? "",
          infoText: data.infoText ?? "",
        },
      },
      {
        onSuccess: (res) => {
          toast({ title: "Đã lưu nội dung menu" });
          // Update cache directly so only this form resets — don't trigger a
          // full refetch which would also reset the shop-info form mid-edit.
          queryClient.setQueryData(getGetBotConfigQueryKey(), (old: typeof config) => ({
            ...old,
            warrantyText: res.warrantyText,
            supportText: res.supportText,
            infoText: res.infoText,
          }));
          menuTextsForm.reset({
            warrantyText: res.warrantyText ?? "",
            supportText: res.supportText ?? "",
            infoText: res.infoText ?? "",
          });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Lưu thất bại", description: getApiErrorMessage(err) });
        },
      },
    );
  };

  const handleTestToken = () => {
    const token = form.getValues("botToken");
    if (!token) return;
    // Cannot test a masked token (loaded from server) — prompt user to re-enter
    if (token.includes("****")) {
      toast({ variant: "destructive", title: "Nhập lại token để kiểm tra", description: "Token hiện đang ẩn. Hãy xóa và nhập lại token thật để kiểm tra." });
      return;
    }
    testToken.mutate(
      { data: { token } },
      {
        onSuccess: (res) => {
          if (res.valid) {
            toast({ title: "Token hợp lệ", description: `Bot: @${res.username}` });
          } else {
            toast({ variant: "destructive", title: "Token không hợp lệ", description: res.error || "Lỗi không xác định" });
          }
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Kiểm tra thất bại", description: getApiErrorMessage(err) });
        },
      }
    );
  };

  const handleSetWebhook = () => {
    setWebhook.mutate(
      undefined,
      {
        onSuccess: () => {
          toast({ title: "Đã thiết lập Webhook" });
          queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Thiết lập Webhook thất bại", description: getApiErrorMessage(err) });
        },
      }
    );
  };

  const handleStartBot = () => {
    const token = form.getValues("botToken");
    const adminChatId = form.getValues("adminChatId");
    saveBotTokenConfig.mutate(
      { data: { botToken: token, adminChatId: adminChatId || null } },
      {
        onSuccess: () => {
          setWebhook.mutate(undefined, {
            onSuccess: () => {
              toast({ title: "Đã khởi động Bot", description: "Webhook đã được thiết lập thành công." });
              queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
            },
            onError: (err) => {
              toast({ variant: "destructive", title: "Khởi động Bot thất bại", description: getApiErrorMessage(err) });
            },
          });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Lưu cấu hình thất bại", description: getApiErrorMessage(err) });
        },
      }
    );
  };

  const handleDisconnect = () => {
    if (!confirm("Bạn có chắc muốn ngắt kết nối Bot? Cửa hàng sẽ không thể hoạt động.")) return;
    
    disconnectBot.mutate(
      undefined,
      {
        onSuccess: () => {
          toast({ title: "Đã ngắt kết nối Bot" });
          queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Ngắt kết nối thất bại", description: getApiErrorMessage(err) });
        },
      }
    );
  };

  const handleRegisterCommands = () => {
    registerCommands.mutate(
      undefined,
      {
        onSuccess: () => {
          toast({ title: "Đã cập nhật lệnh bot", description: "Danh sách lệnh đã được đăng ký với Telegram." });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Cập nhật lệnh thất bại", description: getApiErrorMessage(err) });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cấu hình Bot Telegram</h1>
        <p className="text-muted-foreground mt-1">Kết nối và thiết lập Bot Telegram cho cửa hàng của bạn.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              Kết nối Bot
            </CardTitle>
            <CardDescription>Nhập token từ BotFather để kết nối</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="botToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bot Token</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input 
                            type={showToken ? "text" : "password"} 
                            placeholder="1234567890:ABCdefGhIJKlmNoPQRstuVWXyz..." 
                            className="pr-10"
                            data-testid="input-bot-token"
                            {...field} 
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                            onClick={() => setShowToken(v => !v)}
                            data-testid="btn-toggle-token-visibility"
                            tabIndex={-1}
                          >
                            {showToken ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="adminChatId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chat ID Admin</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="VD: 123456789 (ID Telegram của admin)"
                          data-testid="input-admin-chat-id"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">Nhận cảnh báo khi có lỗi thanh toán hoặc hết hàng. Dùng @userinfobot để lấy ID.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={saveBotTokenConfig.isPending} className="flex-1" data-testid="btn-save-bot-config">
                    {saveBotTokenConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Lưu cấu hình
                  </Button>
                  <Button type="button" variant="secondary" onClick={handleTestToken} disabled={testToken.isPending || !form.watch("botToken")} data-testid="btn-test-token">
                    {testToken.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
                    Kiểm tra
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trạng thái & Điều khiển</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 border border-border rounded-md bg-accent/30">
              <div className="space-y-1">
                <p className="text-sm font-medium">Trạng thái kết nối</p>
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${config?.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-destructive'}`} />
                  <span className="text-sm text-muted-foreground">{config?.isConnected ? 'Đã kết nối' : 'Chưa kết nối'}</span>
                </div>
              </div>
              {config?.botUsername && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Bot Username</p>
                  <p className="text-sm text-primary font-medium">@{config.botUsername}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between p-3 border border-border rounded-md bg-accent/30">
              <div className="space-y-1">
                <p className="text-sm font-medium">Webhook URL</p>
                <p className="text-xs text-muted-foreground max-w-[200px] truncate" title={config?.webhookUrl || ""}>
                  {config?.webhookUrl || "Chưa thiết lập"}
                </p>
              </div>
              <div className={`h-2 w-2 rounded-full ${config?.webhookUrl ? 'bg-emerald-500' : 'bg-muted'}`} />
            </div>

            <div className="flex items-center justify-between p-3 border border-border rounded-md bg-accent/30">
              <div className="space-y-1">
                <p className="text-sm font-medium">Cảnh báo Admin</p>
                <p className="text-xs text-muted-foreground">
                  {config?.adminChatId ? `Chat ID: ${config.adminChatId}` : "Chưa cấu hình"}
                </p>
              </div>
              <div className={`h-2 w-2 rounded-full ${config?.adminChatId ? 'bg-emerald-500' : 'bg-muted'}`} />
            </div>

            <div className="p-3 border border-border rounded-md bg-accent/30 text-sm space-y-2">
              <p className="font-medium text-muted-foreground">Hướng dẫn</p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                <li>Nhập token từ @BotFather và lưu</li>
                <li>Nhập Chat ID của admin để nhận cảnh báo</li>
                <li>Bấm "Kiểm tra" để xác thực token</li>
                <li>Bấm "Khởi động Bot" để nhận tin nhắn</li>
              </ol>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <div className="flex gap-2 w-full">
              <Button 
                className="flex-1" 
                onClick={handleStartBot} 
                disabled={saveBotTokenConfig.isPending || setWebhook.isPending || !form.watch("botToken")}
                data-testid="btn-start-bot"
              >
                {saveBotTokenConfig.isPending || setWebhook.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Khởi động Bot
              </Button>
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={handleSetWebhook} 
                disabled={setWebhook.isPending || !config?.botToken}
                data-testid="btn-set-webhook"
              >
                {setWebhook.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plug className="mr-2 h-4 w-4" />}
                Cập nhật Webhook
              </Button>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleRegisterCommands}
              disabled={registerCommands.isPending || !config?.isConnected}
              data-testid="btn-register-commands"
            >
              {registerCommands.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Terminal className="mr-2 h-4 w-4" />}
              Cập nhật lệnh bot
            </Button>
            <Button 
              variant="destructive" 
              className="w-full" 
              onClick={handleDisconnect} 
              disabled={disconnectBot.isPending || !config?.isConnected}
              data-testid="btn-stop-bot"
            >
              {disconnectBot.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
              Dừng Bot / Ngắt kết nối
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            Thông tin cửa hàng &amp; lời chào
          </CardTitle>
          <CardDescription>
            Tuỳ chỉnh tên cửa hàng và lời chào hiển thị khi khách gõ <code>/start</code>.
            Hỗ trợ biến <code>{"{name}"}</code> (tên khách) và <code>{"{shop_name}"}</code> (tên cửa hàng).
            Định dạng Markdown: <code>**in đậm**</code>, <code>*in nghiêng*</code>.
            Để trống để dùng mặc định.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...welcomeForm}>
            <form onSubmit={welcomeForm.handleSubmit(onSaveWelcome)} className="space-y-4">
              <FormField
                control={welcomeForm.control}
                name="shopName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tên cửa hàng</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="VD: Shop Số Hóa 247"
                        data-testid="input-shop-name"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Hiển thị trong lời chào và thông báo của bot.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={welcomeForm.control}
                  name="welcomeMessage"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Lời chào khi /start</FormLabel>
                        <span className={`text-xs ${welcomeMessageLength > 900 ? "text-destructive" : "text-muted-foreground"}`}>
                          {welcomeMessageLength}/1000
                        </span>
                      </div>
                      <FormControl>
                        <Textarea
                          rows={8}
                          placeholder={"👋 Chào mừng {name} đến với {shop_name}!\n\nChọn tùy chọn bên dưới:"}
                          data-testid="textarea-welcome-message"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Dùng <code>{"{name}"}</code> cho tên khách, <code>{"{shop_name}"}</code> cho tên cửa hàng.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <p className="text-sm font-medium leading-none">Xem trước</p>
                  <div
                    className="rounded-md border border-border bg-accent/30 p-3 text-sm min-h-[160px] text-muted-foreground font-mono leading-relaxed"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: welcomePreviewHtml }}
                  />
                  <p className="text-xs text-muted-foreground">Đây là lời chào mẫu khách sẽ thấy (tên khách mẫu: Nguyễn Văn A).</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saveShopInfoConfig.isPending} data-testid="btn-save-welcome">
                  {saveShopInfoConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Lưu thông tin cửa hàng
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Nội dung menu nhanh
          </CardTitle>
          <CardDescription>
            Tuỳ chỉnh nội dung hiển thị khi khách hàng bấm các nút <b>Bảo hành</b>, <b>Hỗ trợ</b>, <b>Thông tin</b> trên menu nhanh phía dưới chat. Hỗ trợ định dạng HTML cơ bản: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;code&gt;</code>. Để trống để dùng mặc định.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...menuTextsForm}>
            <form onSubmit={menuTextsForm.handleSubmit(onSaveMenuTexts)} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={menuTextsForm.control}
                  name="warrantyText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>🛡️ Bảo hành</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={10}
                          placeholder="Nhập nội dung sẽ hiển thị khi khách bấm nút Bảo hành…"
                          data-testid="textarea-warranty-text"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={menuTextsForm.control}
                  name="supportText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>💬 Hỗ trợ</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={10}
                          placeholder="Nhập nội dung sẽ hiển thị khi khách bấm nút Hỗ trợ…"
                          data-testid="textarea-support-text"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={menuTextsForm.control}
                  name="infoText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ℹ️ Thông tin</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={10}
                          placeholder="Nhập nội dung sẽ hiển thị khi khách bấm nút Thông tin…"
                          data-testid="textarea-info-text"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saveMenuTextsConfig.isPending} data-testid="btn-save-menu-texts">
                  {saveMenuTextsConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Lưu nội dung menu
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
