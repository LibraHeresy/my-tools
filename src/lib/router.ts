import { useCallback, useEffect, useState } from "react";

function normalize(hash: string): string {
  const value = hash.replace(/^#/, "");
  if (!value || value === "/") {
    return "/";
  }
  return value.startsWith("/") ? value : `/${value}`;
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => normalize(window.location.hash));

  useEffect(() => {
    const handleChange = () => setRoute(normalize(window.location.hash));
    window.addEventListener("hashchange", handleChange);
    return () => window.removeEventListener("hashchange", handleChange);
  }, []);

  const navigate = useCallback((nextRoute: string) => {
    const next = nextRoute.startsWith("/") ? nextRoute : `/${nextRoute}`;
    if (normalize(window.location.hash) === next) {
      setRoute(next);
      return;
    }
    window.location.hash = next;
  }, []);

  return { route, navigate };
}
