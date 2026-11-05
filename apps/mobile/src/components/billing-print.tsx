import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/config";

/**
 * Fetch a printable HTML document from the API (invoice / receipt), turn it into a PDF and open the
 * share sheet (WhatsApp, email, Drive, print…). Falls back to the system print dialog when sharing
 * isn't available on the device.
 */
export async function sharePdfFromApi(path: string) {
  const token = useAuth.getState().accessToken;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token ?? ""}`, Accept: "text/html" } });
  } catch {

    throw new ApiError(0, "NETWORK", "Can't reach Movement Hub. Check your internet connection.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? "ERROR", body?.error?.message ?? `Couldn't load the document (${res.status})`);
  }
  // The HTML includes a "Print" button meant for browsers — hide it in the PDF.
  const html = (await res.text()).replace("</head>", "<style>button{display:none!important}</style></head>");

  try {
    if (await Sharing.isAvailableAsync()) {
      const { uri } = await Print.printToFileAsync({ html });

      // expo-sharing's FileProvider on some Android devices can't read the temp path
      // that expo-print writes to. Move the PDF into the app's cache directory first.
      const srcFile = new File(uri);
      const destFile = new File(Paths.cache, srcFile.name ?? `invoice-${Date.now()}.pdf`);
      srcFile.move(destFile);

      await Sharing.shareAsync(destFile.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Share PDF" });
      return;
    }
  } catch (err) {
    console.warn("[Billing Print] Sharing failed, falling back to native print dialog:", err);
  }

  // Native print spooler (provides "Save as PDF" and physical printing without FileProvider permission issues)
  await Print.printAsync({ html });
}
