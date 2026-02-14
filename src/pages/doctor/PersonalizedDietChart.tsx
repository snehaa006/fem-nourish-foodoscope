import React, { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Leaf,
  User,
  Target,
  Heart,
  Clock,
  Flame,
  ChefHat,
  AlertTriangle,
  CheckCircle2,
  Download,
  Save,
  RefreshCw,
  Sparkles,
  Info,
  ShieldCheck,
  Baby,
  Activity,
  Apple,
  Utensils,
  BookOpen,
  XCircle,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import {
  query,
  collection,
  where,
  getDocs,
  getDoc,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { toast } from "sonner";
import {
  generateDietChart,
  determinePrimaryDosha,
  getNutritionalTargets,
  buildExcludeIngredients,
  buildIncludeIngredients,
  DOSHA_FOOD_PREFERENCES,
  ALLERGY_INGREDIENT_MAP,
  MEAL_STRUCTURE,
  type PatientProfile,
  type GeneratedDietChart,
  type LifeStage,
  type DietChartDay,
  type DietChartMeal,
} from "@/services/dietChartService";
import {
  searchRecipeById,
  getInstructionsByRecipeId,
  getIngredientsByFlavor,
  getNutritionInfo,
  getMicronutritionInfo,
  type RecipeBasic,
  type FlavorIngredient,
} from "@/services/foodoscopeApi";

// ==================== TYPES ====================

interface PatientListItem {
  firebaseId: string;
  customPatientId: string;
  patientName: string;
  fullPatientProfile: Record<string, unknown>;
}

interface RecipeDetail {
  recipe: RecipeBasic;
  instructions: string;
}

interface FlavorSuggestion {
  ingredient: string;
  flavor: string;
  category: string;
}

// ==================== HELPER COMPONENTS ====================

const DoshaGauge: React.FC<{
  scores: { vata: number; pitta: number; kapha: number };
  primary: string;
}> = ({ scores, primary }) => {
  const total = scores.vata + scores.pitta + scores.kapha;
  const doshaColors: Record<string, string> = {
    vata: "bg-blue-500",
    pitta: "bg-red-500",
    kapha: "bg-green-500",
  };
  const doshaLabels: Record<string, string> = {
    vata: "Vata (Air + Ether)",
    pitta: "Pitta (Fire + Water)",
    kapha: "Kapha (Earth + Water)",
  };

  return (
    <div className="space-y-3">
      {(["vata", "pitta", "kapha"] as const).map((d) => (
        <div key={d} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span
              className={`font-medium ${d === primary ? "text-gray-900" : "text-gray-600"}`}
            >
              {doshaLabels[d]}
              {d === primary && (
                <Badge variant="outline" className="ml-2 text-xs">
                  Primary
                </Badge>
              )}
            </span>
            <span className="text-gray-500">
              {total > 0 ? Math.round((scores[d] / total) * 100) : 0}%
            </span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${doshaColors[d]}`}
              style={{
                width: `${total > 0 ? (scores[d] / total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const NutrientComplianceBar: React.FC<{
  label: string;
  actual: number;
  target: { min: number; max?: number };
  unit: string;
  color: string;
}> = ({ label, actual, target, unit, color }) => {
  const max = target.max || target.min * 1.5;
  const percent = Math.min((actual / max) * 100, 100);
  const isWithinRange = actual >= target.min && actual <= max;
  const isBelow = actual < target.min;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="font-medium text-gray-700">{label}</span>
        <span
          className={
            isWithinRange
              ? "text-green-600"
              : isBelow
                ? "text-amber-600"
                : "text-red-600"
          }
        >
          {Math.round(actual)} / {target.min}
          {target.max ? `-${target.max}` : "+"} {unit}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

const LoadingSkeleton: React.FC = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-8 bg-gray-200 rounded w-1/3" />
    <div className="grid grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-32 bg-gray-200 rounded" />
      ))}
    </div>
    <div className="h-64 bg-gray-200 rounded" />
  </div>
);

// ==================== MAIN COMPONENT ====================

const PersonalizedDietChart: React.FC = () => {
  // --- State ---
  const [patientId, setPatientId] = useState("");
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(
    null
  );
  const [patientRaw, setPatientRaw] = useState<Record<string, unknown> | null>(
    null
  );
  const [patientList, setPatientList] = useState<PatientListItem[]>([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  const [numDays, setNumDays] = useState(7);
  const [dietChart, setDietChart] = useState<GeneratedDietChart | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [selectedRecipe, setSelectedRecipe] = useState<RecipeBasic | null>(
    null
  );
  const [recipeDetail, setRecipeDetail] = useState<RecipeDetail | null>(null);
  const [isLoadingRecipeDetail, setIsLoadingRecipeDetail] = useState(false);
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);

  const [flavorSuggestions, setFlavorSuggestions] = useState<
    FlavorSuggestion[]
  >([]);
  const [isLoadingFlavor, setIsLoadingFlavor] = useState(false);
  const [showFlavorDialog, setShowFlavorDialog] = useState(false);
  const [flavorRecipeName, setFlavorRecipeName] = useState("");

  const [activeDay, setActiveDay] = useState(0);

  // --- Fetch patient list from consultations ---
  const fetchPatients = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      toast.error("Please log in first");
      return;
    }

    setIsLoadingPatients(true);
    try {
      const consultationQuery = query(
        collection(db, "consultationRequests"),
        where("doctorId", "==", currentUser.uid),
        where("status", "==", "accepted")
      );
      const consultationSnapshot = await getDocs(consultationQuery);

      const patients: PatientListItem[] = [];

      for (const docSnap of consultationSnapshot.docs) {
        const data = docSnap.data();
        let profile = data.fullPatientProfile || {
          name: data.patientName || "Unknown Patient",
        };

        if (data.patientId) {
          try {
            const patientDocRef = doc(db, "patients", data.patientId);
            const patientDoc = await getDoc(patientDocRef);
            if (patientDoc.exists()) {
              const patientData = patientDoc.data();
              profile = {
                ...profile,
                patientId: patientData.patientId || data.patientId,
                name: patientData.name || profile.name,
                assessmentData:
                  patientData.assessmentData || profile.assessmentData,
                ...(patientData.assessmentData && {
                  gender:
                    patientData.assessmentData.gender || profile.gender,
                }),
              };
            }
          } catch {
            // continue with basic profile
          }
        }

        patients.push({
          firebaseId: data.patientId,
          customPatientId: profile.patientId || data.patientId,
          patientName: data.patientName || profile.name || "Unknown",
          fullPatientProfile: profile,
        });
      }

      setPatientList(patients);
      if (patients.length === 0) {
        toast.info("No patients found. Accept consultation requests first.");
      }
    } catch (err) {
      console.error("Error fetching patients:", err);
      toast.error("Failed to fetch patients");
    } finally {
      setIsLoadingPatients(false);
    }
  }, []);

  // --- Load patient profile & build PatientProfile for diet service ---
  const loadPatientProfile = useCallback(
    async (selectedId: string) => {
      if (!selectedId) return;

      setIsLoadingProfile(true);
      setPatientProfile(null);
      setDietChart(null);

      try {
        // Find in the list
        let found = patientList.find(
          (p) => p.customPatientId === selectedId || p.firebaseId === selectedId
        );

        // If not found yet, try fetching directly
        if (!found) {
          await fetchPatients();
          found = patientList.find(
            (p) =>
              p.customPatientId === selectedId || p.firebaseId === selectedId
          );
        }

        if (!found) {
          toast.error(
            "Patient not found. Make sure the patient is in your accepted consultations."
          );
          return;
        }

        const raw = found.fullPatientProfile as Record<string, unknown>;
        const assessment = (raw.assessmentData || {}) as Record<
          string,
          unknown
        >;

        // Merge assessment data to top-level
        const merged = { ...raw, ...assessment };
        setPatientRaw(merged);

        // Map to PatientProfile for diet chart service
        const profile: PatientProfile = {
          name: (merged.name as string) || found.patientName,
          gender: (merged.gender as string) || "",
          dob: (merged.dob as string) || (merged.dateOfBirth as string) || "",
          lifeStage:
            ((merged.lifeStage as string) as LifeStage) || "not_applicable",
          pregnancyTrimester: (merged.pregnancyTrimester as string) || "",
          isBreastfeeding: (merged.isBreastfeeding as string) || "",
          menopauseStage: (merged.menopauseStage as string) || "",
          allergies: Array.isArray(merged.allergies)
            ? (merged.allergies as string[])
            : [],
          allergiesOther: (merged.allergiesOther as string) || "",
          foodAvoidances: (merged.foodAvoidances as string) || "",
          dietaryPreferences:
            (merged.dietaryPreferences as string) ||
            (merged.dietaryPreference as string) ||
            "",
          currentConditions: Array.isArray(merged.currentConditions)
            ? (merged.currentConditions as string[])
            : [],
          healthGoals: Array.isArray(merged.healthGoals)
            ? (merged.healthGoals as string[])
            : [],
          bodyFrame: (merged.bodyFrame as string) || "",
          skinType: (merged.skinType as string) || "",
          hairType: (merged.hairType as string) || "",
          appetitePattern: (merged.appetitePattern as string) || "",
          personalityTraits: Array.isArray(merged.personalityTraits)
            ? (merged.personalityTraits as string[])
            : [],
          weatherPreference: (merged.weatherPreference as string) || "",
          digestionIssues: Array.isArray(merged.digestionIssues)
            ? (merged.digestionIssues as string[])
            : [],
          energyLevels: Number(merged.energyLevels) || 3,
          stressLevels: Number(merged.stressLevels) || 3,
          physicalActivity: (merged.physicalActivity as string) || "",
          sleepDuration: (merged.sleepDuration as string) || "",
        };

        setPatientProfile(profile);
        setPatientId(selectedId);
        toast.success(`Loaded profile for ${profile.name}`);
      } catch (err) {
        console.error("Error loading patient profile:", err);
        toast.error("Failed to load patient profile");
      } finally {
        setIsLoadingProfile(false);
      }
    },
    [patientList, fetchPatients]
  );

  // --- Generate the diet chart ---
  const handleGenerate = useCallback(async () => {
    if (!patientProfile) {
      toast.error("Please select a patient first");
      return;
    }

    if (!patientProfile.bodyFrame || !patientProfile.skinType) {
      toast.error(
        "Patient assessment is incomplete. Missing: body frame and/or skin type. Please ask the patient to complete the health questionnaire."
      );
      return;
    }

    setIsGenerating(true);
    setDietChart(null);
    setActiveDay(0);

    try {
      const chart = await generateDietChart(patientProfile, numDays);
      setDietChart(chart);
      toast.success(
        `Diet chart generated: ${chart.days.length} days, Dosha: ${chart.primaryDosha.toUpperCase()}`
      );
    } catch (err) {
      console.error("Error generating diet chart:", err);
      toast.error("Failed to generate diet chart. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }, [patientProfile, numDays]);

  // --- View recipe details ---
  const handleViewRecipe = useCallback(async (recipe: RecipeBasic) => {
    setSelectedRecipe(recipe);
    setShowRecipeDialog(true);
    setIsLoadingRecipeDetail(true);
    setRecipeDetail(null);

    try {
      const [recipeData, instructionsData] = await Promise.all([
        searchRecipeById(recipe.Recipe_id || recipe._id),
        getInstructionsByRecipeId(recipe.Recipe_id || recipe._id),
      ]);

      setRecipeDetail({
        recipe: recipeData || recipe,
        instructions:
          typeof instructionsData === "string"
            ? instructionsData
            : instructionsData?.instructions || recipe.instructions || "No instructions available.",
      });
    } catch (err) {
      console.error("Error fetching recipe details:", err);
      setRecipeDetail({
        recipe,
        instructions: recipe.instructions || "Could not load instructions.",
      });
    } finally {
      setIsLoadingRecipeDetail(false);
    }
  }, []);

  // --- Enhance flavor ---
  const handleEnhanceFlavor = useCallback(
    async (recipe: RecipeBasic) => {
      setFlavorRecipeName(recipe.Recipe_title);
      setShowFlavorDialog(true);
      setIsLoadingFlavor(true);
      setFlavorSuggestions([]);

      const flavors = ["sweet", "sour", "bitter", "salty", "umami", "pungent"];
      const excludeSet = new Set(
        patientProfile ? buildExcludeIngredients(patientProfile) : []
      );

      try {
        const allSuggestions: FlavorSuggestion[] = [];

        // Fetch ingredients for a few key flavors in parallel
        const flavorPromises = flavors.slice(0, 4).map(async (flavor) => {
          try {
            const results = await getIngredientsByFlavor(flavor, 10);
            if (results && Array.isArray(results)) {
              return results
                .filter(
                  (item: FlavorIngredient) =>
                    !excludeSet.has(
                      (item.ingredient_name || item.entity_alias_readable || "").toLowerCase()
                    )
                )
                .slice(0, 5)
                .map((item: FlavorIngredient) => ({
                  ingredient:
                    item.entity_alias_readable ||
                    item.ingredient_name ||
                    "Unknown",
                  flavor,
                  category: item.category || "General",
                }));
            }
            return [];
          } catch {
            return [];
          }
        });

        const results = await Promise.all(flavorPromises);
        results.forEach((r) => allSuggestions.push(...r));

        setFlavorSuggestions(allSuggestions);

        if (allSuggestions.length === 0) {
          toast.info("No flavor suggestions found for this recipe");
        }
      } catch (err) {
        console.error("Error fetching flavor suggestions:", err);
        toast.error("Failed to fetch flavor suggestions");
      } finally {
        setIsLoadingFlavor(false);
      }
    },
    [patientProfile]
  );

  // --- Save diet chart to Firebase ---
  const handleSave = useCallback(
    async (status: "draft" | "final") => {
      if (!dietChart || !patientId) return;

      setIsSaving(true);
      try {
        const planId = crypto.randomUUID();
        const planData = {
          patientName: dietChart.patientName,
          patientId,
          planDuration: `${numDays} days`,
          planType: "personalized-diet-chart",
          status,
          createdBy: auth.currentUser?.uid || "",
          createdAt: serverTimestamp(),
          lastModified: serverTimestamp(),
          source: "personalized-diet-chart",
          primaryDosha: dietChart.primaryDosha,
          lifeStage: dietChart.lifeStage,
          lifeStageLabel: dietChart.lifeStageLabel,
          nutritionalTargets: dietChart.nutritionalTargets,
          doshaRecommendations: dietChart.doshaRecommendations,
          medicalNotes: dietChart.medicalNotes,
          excludedIngredients: dietChart.excludedIngredients,
          days: dietChart.days.map((day) => ({
            dayNumber: day.dayNumber,
            dayLabel: day.dayLabel,
            totalCalories: day.totalCalories,
            totalProtein: day.totalProtein,
            totalCarbs: day.totalCarbs,
            totalFat: day.totalFat,
            meals: day.meals.map((meal) => ({
              mealType: meal.mealType,
              label: meal.label,
              time: meal.time,
              targetCalories: meal.targetCalories,
              actualCalories: meal.actualCalories,
              recipeName: meal.recipe.Recipe_title || "",
              recipeId: meal.recipe.Recipe_id || meal.recipe._id || "",
              calories: meal.recipe.Calories || 0,
              protein: meal.recipe["Protein (g)"] || 0,
              carbs: meal.recipe["Carbohydrate, by difference (g)"] || 0,
              fat: meal.recipe["Total lipid (fat) (g)"] || 0,
              region: meal.recipe.Region || "",
              cookTime: meal.recipe.cook_time || "",
              isVegan: meal.recipe.vegan || "0",
              isVegetarian: meal.recipe.lacto_vegetarian || "0",
            })),
          })),
          generatedAt: dietChart.generatedAt,
        };

        await setDoc(
          doc(db, `patients/${patientId}/dietPlans/${planId}`),
          planData
        );
        toast.success(
          `Diet chart ${status === "final" ? "approved and " : ""}saved successfully!`
        );
      } catch (err) {
        console.error("Error saving diet chart:", err);
        toast.error("Failed to save diet chart");
      } finally {
        setIsSaving(false);
      }
    },
    [dietChart, patientId, numDays]
  );

  // --- Compute analysis from profile ---
  const profileAnalysis = patientProfile
    ? (() => {
        const dosha = determinePrimaryDosha(patientProfile);
        const targets = getNutritionalTargets(
          patientProfile.lifeStage as LifeStage,
          patientProfile.pregnancyTrimester,
          patientProfile.isBreastfeeding,
          patientProfile.menopauseStage
        );
        const excludes = buildExcludeIngredients(patientProfile);
        const includes = buildIncludeIngredients(patientProfile);
        const doshaPrefs =
          DOSHA_FOOD_PREFERENCES[dosha.primary] ||
          DOSHA_FOOD_PREFERENCES["vata"];

        return { dosha, targets, excludes, includes, doshaPrefs };
      })()
    : null;

  // ==================== RENDER ====================

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Leaf className="w-8 h-8 text-green-600" />
            Personalized Diet Chart
          </h1>
          <p className="text-gray-500 mt-1">
            Generate medically-guided, dosha-personalized meal plans using
            FoodOScope recipes
          </p>
        </div>
      </div>

      {/* Step 1: Patient Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="w-5 h-5 text-blue-600" />
            Step 1: Select Patient
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Label>Patient ID</Label>
              <Input
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="Enter patient ID (e.g., P001)"
              />
            </div>
            <Button
              onClick={() => loadPatientProfile(patientId.trim())}
              disabled={!patientId.trim() || isLoadingProfile}
            >
              {isLoadingProfile ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Search className="w-4 h-4 mr-2" />
              )}
              Load Profile
            </Button>
            <Button variant="outline" onClick={fetchPatients} disabled={isLoadingPatients}>
              {isLoadingPatients ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh List
            </Button>
          </div>

          {/* Patient quick select */}
          {patientList.length > 0 && (
            <div>
              <Label className="text-xs text-gray-500">
                Quick Select from Accepted Consultations
              </Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {patientList.map((p) => (
                  <Button
                    key={p.firebaseId}
                    variant={
                      patientId === p.customPatientId ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => {
                      setPatientId(p.customPatientId);
                      loadPatientProfile(p.customPatientId);
                    }}
                  >
                    {p.patientName} ({p.customPatientId})
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Patient Profile Summary */}
      {patientProfile && profileAnalysis && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Dosha Analysis */}
          <Card className="border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="w-5 h-5 text-blue-600" />
                Dosha Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DoshaGauge
                scores={profileAnalysis.dosha.scores}
                primary={profileAnalysis.dosha.primary}
              />
              <div className="pt-2 border-t">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Recommendation:</span>{" "}
                  {profileAnalysis.doshaPrefs.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {profileAnalysis.doshaPrefs.spices.map((s) => (
                  <Badge
                    key={s}
                    variant="outline"
                    className="text-xs bg-amber-50 border-amber-200"
                  >
                    {s}
                  </Badge>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">
                  Cooking Methods
                </p>
                <div className="flex flex-wrap gap-1">
                  {profileAnalysis.doshaPrefs.cookingMethods.map((m) => (
                    <Badge key={m} variant="secondary" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Life Stage & Medical Info */}
          <Card className="border-pink-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {patientProfile.lifeStage === "pregnancy" ? (
                  <Baby className="w-5 h-5 text-pink-600" />
                ) : patientProfile.lifeStage === "menopause" ? (
                  <Activity className="w-5 h-5 text-pink-600" />
                ) : (
                  <Heart className="w-5 h-5 text-pink-600" />
                )}
                Life Stage & Guidelines
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-pink-100 text-pink-800 border-pink-200">
                  {profileAnalysis.targets.calories.label}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">Calories:</span>
                  <span className="font-medium ml-1">
                    {profileAnalysis.targets.calories.min}-
                    {profileAnalysis.targets.calories.max} kcal
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Protein:</span>
                  <span className="font-medium ml-1">
                    {profileAnalysis.targets.protein.min}-
                    {profileAnalysis.targets.protein.max}{" "}
                    {profileAnalysis.targets.protein.unit}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Iron:</span>
                  <span className="font-medium ml-1">
                    {profileAnalysis.targets.iron.min}{" "}
                    {profileAnalysis.targets.iron.unit}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Calcium:</span>
                  <span className="font-medium ml-1">
                    {profileAnalysis.targets.calcium.min}{" "}
                    {profileAnalysis.targets.calcium.unit}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Folate:</span>
                  <span className="font-medium ml-1">
                    {profileAnalysis.targets.folate.min}{" "}
                    {profileAnalysis.targets.folate.unit}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Vitamin D:</span>
                  <span className="font-medium ml-1">
                    {profileAnalysis.targets.vitaminD.min}{" "}
                    {profileAnalysis.targets.vitaminD.unit}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Fiber:</span>
                  <span className="font-medium ml-1">
                    {profileAnalysis.targets.fiber.min}{" "}
                    {profileAnalysis.targets.fiber.unit}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Omega-3:</span>
                  <span className="font-medium ml-1">
                    {profileAnalysis.targets.omega3.min}{" "}
                    {profileAnalysis.targets.omega3.unit}
                  </span>
                </div>
              </div>

              {/* Guideline source */}
              <div className="flex items-center gap-1 text-xs text-gray-400 pt-1">
                <ShieldCheck className="w-3 h-3" />
                {patientProfile.lifeStage === "pregnancy"
                  ? "ACOG Guidelines"
                  : patientProfile.lifeStage === "postpartum"
                    ? "WHO Postpartum Guidelines"
                    : patientProfile.lifeStage === "menopause"
                      ? "NAMS/Endocrine Society"
                      : "Standard Dietary Guidelines"}
              </div>
            </CardContent>
          </Card>

          {/* Allergies & Restrictions */}
          <Card className="border-amber-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                Restrictions & Focus
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Allergies */}
              {patientProfile.allergies.length > 0 &&
                !patientProfile.allergies.includes("none") && (
                  <div>
                    <p className="text-xs font-medium text-red-600 mb-1">
                      Allergies
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {patientProfile.allergies.map((a) => (
                        <Badge
                          key={a}
                          variant="destructive"
                          className="text-xs"
                        >
                          <XCircle className="w-3 h-3 mr-1" />
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

              {/* Excluded ingredients */}
              <div>
                <p className="text-xs font-medium text-amber-600 mb-1">
                  Excluded Ingredients ({profileAnalysis.excludes.length})
                </p>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {profileAnalysis.excludes.slice(0, 20).map((e) => (
                    <Badge
                      key={e}
                      variant="outline"
                      className="text-xs border-red-200 text-red-700 bg-red-50"
                    >
                      {e}
                    </Badge>
                  ))}
                  {profileAnalysis.excludes.length > 20 && (
                    <Badge variant="outline" className="text-xs">
                      +{profileAnalysis.excludes.length - 20} more
                    </Badge>
                  )}
                </div>
              </div>

              {/* Focus ingredients */}
              <div>
                <p className="text-xs font-medium text-green-600 mb-1">
                  Focus Ingredients ({profileAnalysis.includes.length})
                </p>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {profileAnalysis.includes.slice(0, 15).map((i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-xs border-green-200 text-green-700 bg-green-50"
                    >
                      {i}
                    </Badge>
                  ))}
                  {profileAnalysis.includes.length > 15 && (
                    <Badge variant="outline" className="text-xs">
                      +{profileAnalysis.includes.length - 15} more
                    </Badge>
                  )}
                </div>
              </div>

              {/* Dietary preference */}
              {patientProfile.dietaryPreferences && (
                <div className="flex items-center gap-2 pt-1">
                  <Apple className="w-4 h-4 text-green-600" />
                  <span className="text-sm capitalize">
                    {patientProfile.dietaryPreferences}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Medical Notes */}
      {profileAnalysis &&
        profileAnalysis.targets.notes.length > 0 && (
          <Card className="border-blue-100 bg-blue-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-blue-800">
                <BookOpen className="w-5 h-5" />
                Medical Guidelines & Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-2">
                {profileAnalysis.targets.notes.map((note, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-sm text-blue-900"
                  >
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Step 3: Generate Diet Chart */}
      {patientProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ChefHat className="w-5 h-5 text-green-600" />
              Step 2: Generate Diet Chart
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div>
                <Label>Plan Duration</Label>
                <Select
                  value={String(numDays)}
                  onValueChange={(v) => setNumDays(Number(v))}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 Days</SelectItem>
                    <SelectItem value="5">5 Days</SelectItem>
                    <SelectItem value="7">7 Days</SelectItem>
                    <SelectItem value="14">14 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="bg-green-600 hover:bg-green-700 gap-2"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating ({numDays} days)...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Personalized Diet Chart
                  </>
                )}
              </Button>
              {dietChart && (
                <div className="flex gap-2 ml-auto">
                  <Button
                    variant="outline"
                    onClick={() => handleSave("draft")}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Save Draft
                  </Button>
                  <Button
                    onClick={() => handleSave("final")}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                    )}
                    Approve & Save
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {isGenerating && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <Loader2 className="w-12 h-12 text-green-600 animate-spin" />
                <Leaf className="w-5 h-5 text-green-700 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-green-800">
                  Generating Personalized Diet Chart
                </p>
                <p className="text-sm text-green-600 mt-1">
                  Fetching {numDays * 5} recipes from FoodOScope API filtered by
                  dosha ({profileAnalysis?.dosha.primary}), life stage (
                  {patientProfile?.lifeStage}), and dietary restrictions...
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Generated Diet Chart Display */}
      {dietChart && (
        <div className="space-y-6">
          {/* Summary Header */}
          <Card className="border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                    <Leaf className="w-6 h-6 text-green-700" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-green-900">
                      {dietChart.patientName}'s Diet Chart
                    </h2>
                    <div className="flex items-center gap-3 mt-1">
                      <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                        {dietChart.primaryDosha.toUpperCase()} Dosha
                      </Badge>
                      <Badge className="bg-pink-100 text-pink-800 border-pink-200">
                        {dietChart.lifeStageLabel}
                      </Badge>
                      <Badge variant="outline">
                        {dietChart.days.length} Days
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <p>
                    Generated:{" "}
                    {new Date(dietChart.generatedAt).toLocaleDateString()}
                  </p>
                  <p>
                    Target:{" "}
                    {dietChart.nutritionalTargets.calories.min}-
                    {dietChart.nutritionalTargets.calories.max} kcal/day
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dosha Recommendations */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="w-4 h-4 text-orange-500" />
                Dosha-Based Recommendations ({dietChart.primaryDosha})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 mb-3">
                {dietChart.doshaRecommendations.description}
              </p>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-medium text-amber-700 mb-1">
                    Recommended Spices
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {dietChart.doshaRecommendations.spices.map((s) => (
                      <Badge
                        key={s}
                        variant="outline"
                        className="text-xs bg-amber-50"
                      >
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-blue-700 mb-1">
                    Cooking Methods
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {dietChart.doshaRecommendations.cookingMethods.map((m) => (
                      <Badge
                        key={m}
                        variant="outline"
                        className="text-xs bg-blue-50"
                      >
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-red-700 mb-1">
                    Foods to Avoid
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {dietChart.doshaRecommendations.avoidFoods.map((f) => (
                      <Badge
                        key={f}
                        variant="outline"
                        className="text-xs bg-red-50 text-red-700"
                      >
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Day-by-Day Tabs */}
          <Tabs
            value={String(activeDay)}
            onValueChange={(v) => setActiveDay(Number(v))}
          >
            <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0">
              {dietChart.days.map((day, idx) => (
                <TabsTrigger
                  key={idx}
                  value={String(idx)}
                  className="data-[state=active]:bg-green-600 data-[state=active]:text-white rounded-lg px-4 py-2 border"
                >
                  <div className="text-center">
                    <div className="font-medium text-sm">{day.dayLabel}</div>
                    <div className="text-xs opacity-80">
                      {day.totalCalories} kcal
                    </div>
                  </div>
                </TabsTrigger>
              ))}
            </TabsList>

            {dietChart.days.map((day, dayIdx) => (
              <TabsContent key={dayIdx} value={String(dayIdx)}>
                <div className="space-y-4 mt-4">
                  {/* Day Summary */}
                  <div className="grid grid-cols-4 gap-3">
                    <Card className="border-green-100">
                      <CardContent className="pt-4 pb-3 text-center">
                        <Flame className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                        <p className="text-2xl font-bold text-orange-600">
                          {day.totalCalories}
                        </p>
                        <p className="text-xs text-gray-500">Calories</p>
                        <NutrientComplianceBar
                          label=""
                          actual={day.totalCalories}
                          target={{
                            min: dietChart.nutritionalTargets.calories.min,
                            max: dietChart.nutritionalTargets.calories.max,
                          }}
                          unit=""
                          color="bg-orange-400"
                        />
                      </CardContent>
                    </Card>
                    <Card className="border-blue-100">
                      <CardContent className="pt-4 pb-3 text-center">
                        <Activity className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                        <p className="text-2xl font-bold text-blue-600">
                          {day.totalProtein}g
                        </p>
                        <p className="text-xs text-gray-500">Protein</p>
                        <NutrientComplianceBar
                          label=""
                          actual={day.totalProtein}
                          target={{
                            min: dietChart.nutritionalTargets.protein.min,
                            max: dietChart.nutritionalTargets.protein.max,
                          }}
                          unit=""
                          color="bg-blue-400"
                        />
                      </CardContent>
                    </Card>
                    <Card className="border-amber-100">
                      <CardContent className="pt-4 pb-3 text-center">
                        <Apple className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                        <p className="text-2xl font-bold text-amber-600">
                          {day.totalCarbs}g
                        </p>
                        <p className="text-xs text-gray-500">Carbs</p>
                      </CardContent>
                    </Card>
                    <Card className="border-purple-100">
                      <CardContent className="pt-4 pb-3 text-center">
                        <Utensils className="w-5 h-5 text-purple-500 mx-auto mb-1" />
                        <p className="text-2xl font-bold text-purple-600">
                          {day.totalFat}g
                        </p>
                        <p className="text-xs text-gray-500">Fat</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Meals */}
                  <div className="space-y-3">
                    {day.meals.map((meal, mealIdx) => (
                      <Card
                        key={mealIdx}
                        className="hover:shadow-md transition-shadow"
                      >
                        <CardContent className="py-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-4 flex-1">
                              {/* Meal time indicator */}
                              <div className="flex flex-col items-center min-w-[80px]">
                                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                                  <Clock className="w-5 h-5 text-green-700" />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                  {meal.time}
                                </p>
                                <Badge
                                  variant="outline"
                                  className="text-xs mt-1"
                                >
                                  {meal.label}
                                </Badge>
                              </div>

                              {/* Recipe info */}
                              <div className="flex-1">
                                <h4 className="font-semibold text-gray-900">
                                  {meal.recipe.Recipe_title}
                                </h4>
                                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                                  {meal.recipe.Region && (
                                    <span>{meal.recipe.Region}</span>
                                  )}
                                  {meal.recipe.cook_time && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {meal.recipe.cook_time}
                                    </span>
                                  )}
                                  {meal.recipe.servings && (
                                    <span>
                                      {meal.recipe.servings} servings
                                    </span>
                                  )}
                                </div>

                                {/* Nutrition badges */}
                                <div className="flex items-center gap-2 mt-2">
                                  <Badge
                                    variant="outline"
                                    className="text-xs bg-orange-50 border-orange-200"
                                  >
                                    <Flame className="w-3 h-3 mr-1 text-orange-500" />
                                    {meal.actualCalories} kcal
                                  </Badge>
                                  {meal.recipe["Protein (g)"] && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs bg-blue-50 border-blue-200"
                                    >
                                      Protein:{" "}
                                      {Number(
                                        meal.recipe["Protein (g)"]
                                      ).toFixed(1)}
                                      g
                                    </Badge>
                                  )}
                                  {meal.recipe[
                                    "Carbohydrate, by difference (g)"
                                  ] && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs bg-amber-50 border-amber-200"
                                    >
                                      Carbs:{" "}
                                      {Number(
                                        meal.recipe[
                                          "Carbohydrate, by difference (g)"
                                        ]
                                      ).toFixed(1)}
                                      g
                                    </Badge>
                                  )}
                                  {meal.recipe["Total lipid (fat) (g)"] && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs bg-purple-50 border-purple-200"
                                    >
                                      Fat:{" "}
                                      {Number(
                                        meal.recipe["Total lipid (fat) (g)"]
                                      ).toFixed(1)}
                                      g
                                    </Badge>
                                  )}
                                  {/* Diet tags */}
                                  {meal.recipe.lacto_vegetarian === "1" && (
                                    <Badge className="text-xs bg-green-100 text-green-800 border-green-200">
                                      Vegetarian
                                    </Badge>
                                  )}
                                  {meal.recipe.vegan === "1" && (
                                    <Badge className="text-xs bg-emerald-100 text-emerald-800 border-emerald-200">
                                      Vegan
                                    </Badge>
                                  )}
                                </div>

                                {/* Target vs actual */}
                                <div className="mt-2">
                                  <NutrientComplianceBar
                                    label="Calorie Target"
                                    actual={meal.actualCalories}
                                    target={{
                                      min: meal.targetCalories * 0.8,
                                      max: meal.targetCalories * 1.2,
                                    }}
                                    unit="kcal"
                                    color="bg-green-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Action buttons */}
                            <div className="flex flex-col gap-2 ml-4">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewRecipe(meal.recipe)}
                                className="text-xs"
                              >
                                <BookOpen className="w-3 h-3 mr-1" />
                                Details
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleEnhanceFlavor(meal.recipe)
                                }
                                className="text-xs text-amber-700 border-amber-200 hover:bg-amber-50"
                              >
                                <Sparkles className="w-3 h-3 mr-1" />
                                Enhance Flavor
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}

                    {day.meals.length === 0 && (
                      <Card className="border-amber-200 bg-amber-50">
                        <CardContent className="py-6 text-center">
                          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                          <p className="text-amber-800">
                            No recipes were found for this day. Try regenerating
                            the chart or adjusting dietary preferences.
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>

          {/* Nutritional Compliance Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-5 h-5 text-green-600" />
                Nutritional Compliance Overview (All Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Calories</TableHead>
                    <TableHead className="text-right">Protein (g)</TableHead>
                    <TableHead className="text-right">Carbs (g)</TableHead>
                    <TableHead className="text-right">Fat (g)</TableHead>
                    <TableHead className="text-right">Meals</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dietChart.days.map((day) => {
                    const calTarget = dietChart.nutritionalTargets.calories;
                    const inRange =
                      day.totalCalories >= calTarget.min * 0.85 &&
                      day.totalCalories <= calTarget.max * 1.15;

                    return (
                      <TableRow key={day.dayNumber}>
                        <TableCell className="font-medium">
                          {day.dayLabel}
                        </TableCell>
                        <TableCell className="text-right">
                          {day.totalCalories}
                        </TableCell>
                        <TableCell className="text-right">
                          {day.totalProtein}
                        </TableCell>
                        <TableCell className="text-right">
                          {day.totalCarbs}
                        </TableCell>
                        <TableCell className="text-right">
                          {day.totalFat}
                        </TableCell>
                        <TableCell className="text-right">
                          {day.meals.length}/5
                        </TableCell>
                        <TableCell className="text-center">
                          {inRange ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              On Target
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-amber-700 border-amber-200"
                            >
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Review
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Excluded Ingredients List */}
          <Accordion type="single" collapsible>
            <AccordionItem value="excluded">
              <AccordionTrigger className="text-sm font-medium">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500" />
                  Excluded Ingredients ({dietChart.excludedIngredients.length})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-wrap gap-1">
                  {dietChart.excludedIngredients.map((ing) => (
                    <Badge
                      key={ing}
                      variant="outline"
                      className="text-xs text-red-700 border-red-200 bg-red-50"
                    >
                      {ing}
                    </Badge>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="notes">
              <AccordionTrigger className="text-sm font-medium">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-blue-500" />
                  Medical Notes ({dietChart.medicalNotes.length})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-2">
                  {dietChart.medicalNotes.map((note, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-sm text-gray-700"
                    >
                      <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                      {note}
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      {/* Recipe Detail Dialog */}
      <Dialog open={showRecipeDialog} onOpenChange={setShowRecipeDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="w-5 h-5 text-green-600" />
              {selectedRecipe?.Recipe_title || "Recipe Details"}
            </DialogTitle>
            <DialogDescription>
              Full recipe details including nutrition, instructions, and diet information.
            </DialogDescription>
          </DialogHeader>

          {isLoadingRecipeDetail ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
          ) : recipeDetail ? (
            <div className="space-y-4">
              {/* Nutrition */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-orange-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-orange-600">
                    {recipeDetail.recipe.Calories || "N/A"}
                  </p>
                  <p className="text-xs text-gray-500">Calories</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-blue-600">
                    {recipeDetail.recipe["Protein (g)"] || "N/A"}
                  </p>
                  <p className="text-xs text-gray-500">Protein (g)</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-amber-600">
                    {recipeDetail.recipe["Carbohydrate, by difference (g)"] ||
                      "N/A"}
                  </p>
                  <p className="text-xs text-gray-500">Carbs (g)</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-purple-600">
                    {recipeDetail.recipe["Total lipid (fat) (g)"] || "N/A"}
                  </p>
                  <p className="text-xs text-gray-500">Fat (g)</p>
                </div>
              </div>

              {/* Recipe Meta */}
              <div className="flex flex-wrap gap-2">
                {recipeDetail.recipe.Region && (
                  <Badge variant="outline">
                    {recipeDetail.recipe.Region}
                  </Badge>
                )}
                {recipeDetail.recipe.cook_time && (
                  <Badge variant="outline">
                    <Clock className="w-3 h-3 mr-1" />
                    Cook: {recipeDetail.recipe.cook_time}
                  </Badge>
                )}
                {recipeDetail.recipe.prep_time && (
                  <Badge variant="outline">
                    Prep: {recipeDetail.recipe.prep_time}
                  </Badge>
                )}
                {recipeDetail.recipe.servings && (
                  <Badge variant="outline">
                    {recipeDetail.recipe.servings} servings
                  </Badge>
                )}
                {recipeDetail.recipe.Utensils && (
                  <Badge variant="outline">
                    <Utensils className="w-3 h-3 mr-1" />
                    {recipeDetail.recipe.Utensils}
                  </Badge>
                )}
              </div>

              {/* Diet Tags */}
              <div className="flex gap-2">
                {recipeDetail.recipe.vegan === "1" && (
                  <Badge className="bg-emerald-100 text-emerald-800">
                    Vegan
                  </Badge>
                )}
                {recipeDetail.recipe.lacto_vegetarian === "1" && (
                  <Badge className="bg-green-100 text-green-800">
                    Lacto-Vegetarian
                  </Badge>
                )}
                {recipeDetail.recipe.ovo_vegetarian === "1" && (
                  <Badge className="bg-lime-100 text-lime-800">
                    Ovo-Vegetarian
                  </Badge>
                )}
                {recipeDetail.recipe.ovo_lacto_vegetarian === "1" && (
                  <Badge className="bg-teal-100 text-teal-800">
                    Ovo-Lacto Vegetarian
                  </Badge>
                )}
                {recipeDetail.recipe.pescetarian === "1" && (
                  <Badge className="bg-cyan-100 text-cyan-800">
                    Pescetarian
                  </Badge>
                )}
              </div>

              {/* Instructions */}
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  Instructions
                </h4>
                <div className="bg-gray-50 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed">
                  {recipeDetail.instructions}
                </div>
              </div>

              {/* Enhance Flavor Button */}
              <Button
                variant="outline"
                className="w-full border-amber-200 text-amber-700 hover:bg-amber-50"
                onClick={() => {
                  setShowRecipeDialog(false);
                  handleEnhanceFlavor(recipeDetail.recipe);
                }}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Enhance Flavor with FlavorDB Suggestions
              </Button>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">
              Could not load recipe details.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Flavor Enhancement Dialog */}
      <Dialog open={showFlavorDialog} onOpenChange={setShowFlavorDialog}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Flavor Enhancement
            </DialogTitle>
            <DialogDescription>
              FlavorDB ingredient suggestions to enhance recipe flavor, filtered by patient restrictions.
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-gray-600 mb-3">
            FlavorDB suggestions to enhance{" "}
            <span className="font-medium">{flavorRecipeName}</span>.
            Ingredients already filtered to exclude patient allergies and
            restrictions.
          </p>

          {isLoadingFlavor ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : flavorSuggestions.length > 0 ? (
            <div className="space-y-4">
              {["sweet", "sour", "bitter", "salty", "umami", "pungent"].map(
                (flavor) => {
                  const items = flavorSuggestions.filter(
                    (s) => s.flavor === flavor
                  );
                  if (items.length === 0) return null;

                  const flavorColors: Record<string, string> = {
                    sweet: "bg-pink-50 border-pink-200 text-pink-800",
                    sour: "bg-yellow-50 border-yellow-200 text-yellow-800",
                    bitter: "bg-green-50 border-green-200 text-green-800",
                    salty: "bg-blue-50 border-blue-200 text-blue-800",
                    umami: "bg-red-50 border-red-200 text-red-800",
                    pungent:
                      "bg-orange-50 border-orange-200 text-orange-800",
                  };

                  return (
                    <div key={flavor}>
                      <h4 className="text-sm font-medium capitalize mb-2">
                        {flavor} Flavor
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {items.map((item, idx) => (
                          <Badge
                            key={idx}
                            variant="outline"
                            className={`text-xs ${flavorColors[flavor] || ""}`}
                          >
                            {item.ingredient}
                            {item.category !== "General" && (
                              <span className="ml-1 opacity-60">
                                ({item.category})
                              </span>
                            )}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">
              No flavor suggestions available after filtering restrictions.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PersonalizedDietChart;
