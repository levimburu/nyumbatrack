import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface Property {
  id: string;
  name: string;
  location: string | null;
}

interface PropertyContextType {
  selectedProperty: Property | null;
  setSelectedProperty: (p: Property | null) => void;
}

const PropertyContext = createContext<PropertyContextType>({
  selectedProperty: null,
  setSelectedProperty: () => {},
});

export function PropertyProvider({ children }: { children: ReactNode }) {
  const [selectedProperty, setSelectedPropertyState] = useState<Property | null>(() => {
    try {
      const stored = localStorage.getItem("nyumbatrack_selected_property");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const setSelectedProperty = (p: Property | null) => {
    setSelectedPropertyState(p);
    if (p) {
      localStorage.setItem("nyumbatrack_selected_property", JSON.stringify(p));
    } else {
      localStorage.removeItem("nyumbatrack_selected_property");
    }
  };

  return (
    <PropertyContext.Provider value={{ selectedProperty, setSelectedProperty }}>
      {children}
    </PropertyContext.Provider>
  );
}

export function useProperty() {
  return useContext(PropertyContext);
}