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

  if (await Sharing.isAvailableAsync()) {
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Share PDF" });
  } else {
    await Print.printAsync({ html });
  }
}
