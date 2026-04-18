import { useGetBotConfig, useSaveBotConfig, useTestBotToken, useSetBotWebhook, useDisconnectBot, getGetBotConfigQueryKey } from "@workspace/api-client-react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Bot, Unplug, Plug, Activity } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const botSchema = z.object({
  botToken: z.string().min(1, "Bot token là bắt buộc"),
});

type BotFormValues = z.infer<typeof botSchema>;

export default function SettingsBot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: config, isLoading } = useGetBotConfig({
    query: { queryKey: getGetBotConfigQueryKey() }
  });

  const saveConfig = useSaveBotConfig();
  const testToken = useTestBotToken();
  const setWebhook = useSetBotWebhook();
  const disconnectBot = useDisconnectBot();

  const form = useForm<BotFormValues>({
    resolver: zodResolver(botSchema),
    defaultValues: {
      botToken: "",
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        botToken: config.botToken || "",
      });
    }
  }, [config, form]);

  const onSubmit = (data: BotFormValues) => {
    saveConfig.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Đã lưu token" });
          queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
        },
      }
    );
  };

  const handleTestToken = () => {
    const token = form.getValues("botToken");
    if (!token) return;
    
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
                        <Input type="password" placeholder="1234567890:ABCdefGhIJKlmNoPQRstuVWXyz..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={saveConfig.isPending} className="flex-1">
                    {saveConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Lưu Token
                  </Button>
                  <Button type="button" variant="secondary" onClick={handleTestToken} disabled={testToken.isPending || !form.watch("botToken")}>
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
            <CardTitle>Trạng thái kết nối</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 border border-border rounded-md bg-accent/30">
              <div className="space-y-1">
                <p className="text-sm font-medium">Trạng thái</p>
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${config?.isConnected ? 'bg-emerald-500' : 'bg-destructive'}`} />
                  <span className="text-sm text-muted-foreground">{config?.isConnected ? 'Đã kết nối' : 'Chưa kết nối'}</span>
                </div>
              </div>
              {config?.botUsername && (
                <div className="text-right">
                  <p className="text-sm font-medium">Bot Username</p>
                  <p className="text-sm text-primary">@{config.botUsername}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between p-3 border border-border rounded-md bg-accent/30">
              <div className="space-y-1">
                <p className="text-sm font-medium">Webhook</p>
                <p className="text-sm text-muted-foreground max-w-[200px] truncate" title={config?.webhookUrl || ""}>
                  {config?.webhookUrl || "Chưa thiết lập"}
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button 
              className="flex-1" 
              onClick={handleSetWebhook} 
              disabled={setWebhook.isPending || !config?.botToken}
            >
              {setWebhook.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plug className="mr-2 h-4 w-4" />}
              Bật Webhook
            </Button>
            <Button 
              variant="destructive" 
              className="flex-1" 
              onClick={handleDisconnect} 
              disabled={disconnectBot.isPending || !config?.isConnected}
            >
              {disconnectBot.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}
              Ngắt kết nối
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
