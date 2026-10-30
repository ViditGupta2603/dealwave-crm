let loading = null;

/** Loads Razorpay's checkout script the first time a payment is started. */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loading = null;
        reject(new Error('Could not load the payment window. Check your connection.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}
