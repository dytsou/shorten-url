// Copy to clipboard utility with fallbacks
export async function copyToClipboard(text) {
  if (!text) {
    return { success: false, message: 'No URL to copy!' };
  }

  try {
    // Try modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return { success: true, message: 'Copied!' };
    } else {
      // Fallback: select text for manual copy
      return { success: false, message: 'Select & Copy', fallback: true };
    }
  } catch (err) {
    console.error('Failed to copy: ', err);
    // Final fallback - select text for manual copy
    return { success: false, message: 'Select & Copy', fallback: true };
  }
}

// Select text in an input element (for fallback)
export function selectText(element) {
  if (element) {
    element.select();
    element.focus();
  }
}

