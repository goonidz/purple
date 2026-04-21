import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

type EmailAccount = {
  id: string;
  name: string;
  email: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_ssl: boolean;
  password_secret_id: string | null;
  updated_at: string;
};

type FormState = {
  id: string | null;
  name: string;
  email: string;
  display_name: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_ssl: boolean;
  password: string;
};

const DEFAULT_FORM: FormState = {
  id: null,
  name: "",
  email: "",
  display_name: "",
  imap_host: "mail.privateemail.com",
  imap_port: 993,
  smtp_host: "mail.privateemail.com",
  smtp_port: 465,
  smtp_ssl: true,
  password: "",
};

// Picks the right base URL for the CRM FastAPI backend. In prod we're
// behind nginx so `/crm/api/...` works directly. In local dev we either
// reverse-proxy via Vite or hit the FastAPI process directly.
const CRM_API_BASE =
  (import.meta.env.VITE_CRM_API_BASE as string | undefined) ?? "/crm";

type Props = {
  userId: string;
};

export default function EmailAccountsManager({ userId }: Props) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<EmailAccount | null>(
    null,
  );

  useEffect(() => {
    loadAccounts();
  }, [userId]);

  async function loadAccounts() {
    setIsLoading(true);
    const { data, error } = await (supabase as any)
      .from("user_email_accounts")
      .select(
        "id,name,email,display_name,imap_host,imap_port,smtp_host,smtp_port,smtp_ssl,password_secret_id,updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    setIsLoading(false);
    if (error) {
      toast.error(`Impossible de charger les comptes : ${error.message}`);
      return;
    }
    setAccounts((data as EmailAccount[]) ?? []);
  }

  function openCreate() {
    setForm({ ...DEFAULT_FORM });
    setShowPassword(false);
    setDialogOpen(true);
  }

  function openEdit(account: EmailAccount) {
    setForm({
      id: account.id,
      name: account.name,
      email: account.email,
      display_name: account.display_name ?? "",
      imap_host: account.imap_host,
      imap_port: account.imap_port,
      smtp_host: account.smtp_host,
      smtp_port: account.smtp_port,
      smtp_ssl: account.smtp_ssl,
      password: "",
    });
    setShowPassword(false);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Nom et email requis");
      return;
    }
    if (!form.id && !form.password) {
      toast.error("Mot de passe requis à la création du compte");
      return;
    }

    setIsSaving(true);
    const { error } = await (supabase as any).rpc("store_user_email_account", {
      p_id: form.id,
      p_name: form.name.trim(),
      p_email: form.email.trim().toLowerCase(),
      p_display_name: form.display_name.trim() || null,
      p_imap_host: form.imap_host.trim(),
      p_imap_port: form.imap_port,
      p_smtp_host: form.smtp_host.trim(),
      p_smtp_port: form.smtp_port,
      p_smtp_ssl: form.smtp_ssl,
      p_password: form.password || null,
    });
    setIsSaving(false);

    if (error) {
      toast.error(`Échec de l'enregistrement : ${error.message}`);
      return;
    }

    toast.success(
      form.id ? "Compte mis à jour" : "Compte email ajouté",
    );
    setDialogOpen(false);
    await loadAccounts();
  }

  async function handleDelete(account: EmailAccount) {
    const { error } = await (supabase as any).rpc("delete_user_email_account", {
      account_id: account.id,
    });
    if (error) {
      toast.error(`Impossible de supprimer : ${error.message}`);
      return;
    }
    toast.success("Compte supprimé");
    setDeleteCandidate(null);
    await loadAccounts();
  }

  async function handleTest() {
    if (!form.email || !form.password || !form.imap_host || !form.smtp_host) {
      toast.error("Remplis tous les champs avant de tester");
      return;
    }
    setIsTesting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Non authentifié");
      const resp = await fetch(`${CRM_API_BASE}/api/test-account`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          imap_host: form.imap_host,
          imap_port: form.imap_port,
          smtp_host: form.smtp_host,
          smtp_port: form.smtp_port,
          smtp_ssl: form.smtp_ssl,
          name: form.name,
          display_name: form.display_name,
        }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data.ok) {
        toast.success("Connexion IMAP + SMTP réussie");
      } else {
        toast.error(`Échec : ${data.error ?? "réponse invalide"}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        `Test impossible (${msg}). Le backend CRM tourne-t-il sur /crm/ ?`,
      );
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Comptes Email</h2>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> Ajouter un compte
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Les comptes sont stockés de manière chiffrée dans Supabase Vault. Ils
        sont utilisés uniquement par le module CRM (onglet webmail).{" "}
        <a
          href="/crm/"
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          Ouvrir le CRM <ExternalLink className="h-3 w-3" />
        </a>
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : accounts.length === 0 ? (
        <Card className="p-8 text-center bg-muted/30 border-dashed">
          <Mail className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Aucun compte email pour l'instant. Ajoute ton premier compte IMAP
            pour commencer à l'utiliser depuis le CRM.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <Card
              key={account.id}
              className="p-4 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{account.name}</span>
                  {account.password_secret_id ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                      <CheckCircle2 className="h-3 w-3" />
                      Mot de passe stocké
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive">
                      <XCircle className="h-3 w-3" />
                      Mot de passe manquant
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {account.email}
                </div>
                <div className="text-xs text-muted-foreground">
                  IMAP {account.imap_host}:{account.imap_port} · SMTP{" "}
                  {account.smtp_host}:{account.smtp_port}
                  {account.smtp_ssl ? " (SSL)" : " (STARTTLS)"}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openEdit(account)}
                  title="Modifier"
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteCandidate(account)}
                  title="Supprimer"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create/edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Modifier le compte" : "Nouveau compte email"}
            </DialogTitle>
            <DialogDescription>
              Les paramètres IMAP/SMTP par défaut sont ceux de
              privateemail.com. Adapte-les selon ton fournisseur.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ea-name">Nom du compte</Label>
                <Input
                  id="ea-name"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="Pro, Perso, ..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ea-display">Nom affiché</Label>
                <Input
                  id="ea-display"
                  value={form.display_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, display_name: e.target.value }))
                  }
                  placeholder="Tom Dupont"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ea-email">Adresse email</Label>
              <Input
                id="ea-email"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="nom@exemple.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ea-password">
                Mot de passe {form.id && "(laisser vide pour conserver)"}
              </Label>
              <div className="relative">
                <Input
                  id="ea-password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password: e.target.value }))
                  }
                  placeholder="••••••••"
                  className="pr-10"
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ea-imap-host">Serveur IMAP</Label>
                <Input
                  id="ea-imap-host"
                  value={form.imap_host}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, imap_host: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ea-imap-port">Port IMAP</Label>
                <Input
                  id="ea-imap-port"
                  type="number"
                  value={form.imap_port}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      imap_port: Number(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ea-smtp-host">Serveur SMTP</Label>
                <Input
                  id="ea-smtp-host"
                  value={form.smtp_host}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, smtp_host: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ea-smtp-port">Port SMTP</Label>
                <Input
                  id="ea-smtp-port"
                  type="number"
                  value={form.smtp_port}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      smtp_port: Number(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="ea-ssl">SMTP SSL/TLS direct</Label>
                <p className="text-xs text-muted-foreground">
                  Décoche pour utiliser STARTTLS (port 587 typiquement).
                </p>
              </div>
              <Switch
                id="ea-ssl"
                checked={form.smtp_ssl}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, smtp_ssl: v }))
                }
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={isTesting || isSaving}
            >
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Test...
                </>
              ) : (
                "Tester la connexion"
              )}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enregistrement...
                </>
              ) : form.id ? (
                "Enregistrer"
              ) : (
                "Ajouter"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteCandidate}
        onOpenChange={(open) => !open && setDeleteCandidate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer {deleteCandidate?.name} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette action supprime définitivement la fiche et le mot de passe
              stocké dans Vault. Les emails sur le serveur IMAP ne sont pas
              touchés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteCandidate && handleDelete(deleteCandidate)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
