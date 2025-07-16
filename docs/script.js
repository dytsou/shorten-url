// Get the current domain for the URL prefix
const currentDomain = window.location.host;
const urlPrefix = document.querySelector('.url-prefix');
const customSlugInput = document.getElementById('customSlug');

urlPrefix.textContent = currentDomain + '/';

document.getElementById('urlForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const longUrl = document.getElementById('longUrl').value;
  const customSlug = document.getElementById('customSlug').value;

  // Show loading, hide previous results
  document.getElementById('loading').classList.add('show');
  document.getElementById('result').classList.remove('show');
  document.getElementById('error').classList.remove('show');

  try {
    // Prepare the request payload
    const payload = {
      url: longUrl
    };

    // Add custom slug if provided
    if (customSlug && customSlug.trim() !== '') {
      payload.custom_slug = customSlug.trim();
    }

    // Make API call to your Cloudflare Worker
    const response = await fetch(window.location.origin, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    // Hide loading
    document.getElementById('loading').classList.remove('show');

    if (response.ok && result.status === 200) {
      // Show success result
      const shortUrl = window.location.origin + (result.key.startsWith('/') ? result.key : '/' + result.key);
      document.getElementById('shortUrlOutput').value = shortUrl;
      document.getElementById('result').classList.add('show');

      // Reset form
      document.getElementById('urlForm').reset();
    } else {
      // Show error
      const errorMsg = result.message || result.key || 'An error occurred while shortening the URL.';
      document.getElementById('error').textContent = errorMsg;
      document.getElementById('error').classList.add('show');
    }

  } catch (error) {
    // Hide loading
    document.getElementById('loading').classList.remove('show');

    // Show error
    document.getElementById('error').textContent = 'Network error. Please try again.';
    document.getElementById('error').classList.add('show');
  }
});

// Modern copy to clipboard function with fallbacks
async function copyToClipboard() {
  const shortUrlInput = document.getElementById('shortUrlOutput');
  const copyBtn = document.querySelector('.copy-btn');
  const originalText = copyBtn.textContent;
  const originalBg = copyBtn.style.backgroundColor || '#28a745';

  if (!shortUrlInput.value) {
    showCopyFeedback(copyBtn, 'No URL!', '#dc3545', originalText, originalBg);
    return;
  }

  try {
    // Try modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(shortUrlInput.value);
      showCopyFeedback(copyBtn, 'Copied!', '#28a745', originalText, originalBg);
    } else {
      // Fallback: ask user to copy manually
      shortUrlInput.select();
      shortUrlInput.focus();
      showCopyFeedback(copyBtn, 'Select & Copy', '#ffc107', originalText, originalBg, 3000);
    }
  } catch (err) {
    console.error('Failed to copy: ', err);

    // Final fallback - show the URL and ask user to copy manually
    shortUrlInput.select();
    shortUrlInput.focus();
    showCopyFeedback(copyBtn, 'Select & Copy', '#ffc107', originalText, originalBg, 3000);
  }
}

// Helper function for copy feedback
function showCopyFeedback(button, text, bgColor, originalText, originalBg, duration = 2000) {
  button.textContent = text;
  button.style.backgroundColor = bgColor;
  button.style.transform = 'scale(0.95)';

  setTimeout(() => {
    button.textContent = originalText;
    button.style.backgroundColor = originalBg;
    button.style.transform = 'scale(1)';
  }, duration);
}

// Shorten URL and Visit function
async function shortenAndVisit() {
  const longUrl = document.getElementById('longUrl').value;
  const customSlug = document.getElementById('customSlug').value;
  const gotoBtn = document.querySelector('.goto-btn');
  const originalText = gotoBtn.textContent;
  const originalBg = gotoBtn.style.backgroundColor || '#007bff';

  // Validate URL input
  if (!longUrl) {
    showGotoFeedback(gotoBtn, 'Enter URL first!', '#dc3545', originalText, originalBg);
    return;
  }

  // Show processing state
  showGotoFeedback(gotoBtn, 'Shortening...', '#ffc107', originalText, originalBg, 10000);

  try {
    // Prepare the request payload
    const payload = {
      url: longUrl
    };

    // Add custom slug if provided
    if (customSlug && customSlug.trim() !== '') {
      payload.custom_slug = customSlug.trim();
    }

    // Make API call to shorten URL
    const response = await fetch(window.location.origin, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (response.ok && result.status === 200) {
      // URL shortened successfully, now open it
      const shortUrl = window.location.origin + (result.key.startsWith('/') ? result.key : '/' + result.key);

      // Open the shortened URL in a new tab
      window.open(shortUrl, '_blank', 'noopener,noreferrer');

      // Show success feedback
      showGotoFeedback(gotoBtn, 'Opened!', '#28a745', originalText, originalBg);

      // Reset form
      document.getElementById('urlForm').reset();

      // Also show the shortened URL in the result area
      document.getElementById('shortUrlOutput').value = shortUrl;
      document.getElementById('result').classList.add('show');
      document.getElementById('error').classList.remove('show');
    } else {
      // Show error
      const errorMsg = result.message || result.key || 'Error shortening URL';
      showGotoFeedback(gotoBtn, 'Error!', '#dc3545', originalText, originalBg);
      document.getElementById('error').textContent = errorMsg;
      document.getElementById('error').classList.add('show');
    }

  } catch (error) {
    console.error('Network error:', error);
    showGotoFeedback(gotoBtn, 'Network Error!', '#dc3545', originalText, originalBg);
    document.getElementById('error').textContent = 'Network error. Please try again.';
    document.getElementById('error').classList.add('show');
  }
}

// Helper function for goto feedback
function showGotoFeedback(button, text, bgColor, originalText, originalBg, duration = 2000) {
  button.textContent = text;
  button.style.backgroundColor = bgColor;
  button.style.transform = 'scale(0.95)';

  setTimeout(() => {
    button.textContent = originalText;
    button.style.backgroundColor = originalBg;
    button.style.transform = 'scale(1)';
  }, duration);
}

// Custom slug validation
document.getElementById('customSlug').addEventListener('input', function (e) {
  const value = e.target.value;
  const validPattern = /^[a-zA-Z0-9\-_]*$/;

  if (!validPattern.test(value)) {
    e.target.setCustomValidity('Only letters, numbers, hyphens, and underscores are allowed');
  } else {
    e.target.setCustomValidity('');
  }
}); 