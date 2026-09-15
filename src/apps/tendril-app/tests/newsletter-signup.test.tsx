import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewsletterSignup, isValidEmail } from "../src/components/NewsletterSignup";
import { bridge } from "../src/api/bridge";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isValidEmail", () => {
  it.each(["a@b.co", "First.Last+tag@sub.example.com", "MiXeD@CaSe.io"])("accepts %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(["", "   ", "no-at-sign", "a@b", "a b@c.d", "a@ b.c", "@b.co", "a@"])(
    "rejects %j",
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );
});

describe("NewsletterSignup", () => {
  it("disables submit for an empty and for a malformed address, enables it for a valid one", () => {
    render(<NewsletterSignup />);

    const email = screen.getByTestId("newsletter-email");
    const submit = screen.getByTestId("newsletter-submit");
    expect(submit).toBeDisabled();

    fireEvent.change(email, { target: { value: "not-an-email" } });
    expect(submit).toBeDisabled();

    fireEvent.change(email, { target: { value: "a@b.co" } });
    expect(submit).toBeEnabled();
  });

  it("shows the success state and drops the form on a successful subscribe", async () => {
    const subscribeNewsletter = vi
      .spyOn(bridge, "subscribeNewsletter")
      .mockResolvedValue({ subscribed: true, error: null });

    render(<NewsletterSignup />);

    fireEvent.change(screen.getByTestId("newsletter-email"), {
      target: { value: "  a@b.co  " },
    });
    fireEvent.click(screen.getByTestId("newsletter-submit"));

    await waitFor(() => expect(screen.getByTestId("newsletter-success")).toBeInTheDocument());
    expect(screen.queryByTestId("newsletter-email")).not.toBeInTheDocument();
    expect(subscribeNewsletter).toHaveBeenCalledOnce();
    expect(subscribeNewsletter).toHaveBeenCalledWith("a@b.co");
  });

  it("renders the daemon's error message and keeps the form for a rejected outcome", async () => {
    vi.spyOn(bridge, "subscribeNewsletter").mockResolvedValue({
      subscribed: false,
      error: "Too many attempts. Please try again later.",
    });

    render(<NewsletterSignup />);

    fireEvent.change(screen.getByTestId("newsletter-email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByTestId("newsletter-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("newsletter-error")).toHaveTextContent(
        "Too many attempts. Please try again later.",
      ),
    );
    expect(screen.getByTestId("newsletter-email")).toBeInTheDocument();
  });

  it("renders an error and does not throw when the bridge call rejects", async () => {
    vi.spyOn(bridge, "subscribeNewsletter").mockRejectedValue(new Error("daemon unreachable"));

    render(<NewsletterSignup />);

    fireEvent.change(screen.getByTestId("newsletter-email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByTestId("newsletter-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("newsletter-error")).toHaveTextContent("daemon unreachable"),
    );
  });
});
