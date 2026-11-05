import type { View } from "@/lib/views";

// The five steps from a product brief to a next move. The help panel and the guided tour both
// read this list, and each step's id is also the data-tour attribute on the element it points at.
export type WorkflowStepId = "product" | "content" | "purchase" | "results" | "next";

export type WorkflowStep = {
  id: WorkflowStepId;
  title: string;
  copy: string;
  action: string;
  view: View;
  complete: boolean;
};

export type WorkflowState = {
  hasCampaign: boolean;
  approved: boolean;
  hasRevenue: boolean;
  hasRecommendation: boolean;
};

export function workflowSteps({
  hasCampaign,
  approved,
  hasRevenue,
  hasRecommendation,
}: WorkflowState): WorkflowStep[] {
  return [
    {
      id: "product",
      title: "Describe your product",
      copy: "Set the audience, revenue goal, channels, and voice.",
      action: hasCampaign ? "Review product" : "Add product",
      view: hasCampaign ? "products" : "new-campaign",
      complete: hasCampaign,
    },
    {
      id: "content",
      title: "Review the campaign",
      copy: "Edit the drafted posts and approve the work you want to use.",
      action: "Open content",
      view: "content",
      complete: approved,
    },
    {
      id: "purchase",
      title: "Test the purchase",
      copy: "Buy from your own post in the PayPal sandbox. No real money moves.",
      action: "Open checkout",
      view: "checkout",
      complete: hasRevenue,
    },
    {
      id: "results",
      title: "Read verified results",
      copy: "Trace each purchase back to the post that earned it.",
      action: "View results",
      view: "results",
      complete: hasRevenue,
    },
    {
      id: "next",
      title: "Choose the next test",
      copy: "Let the agent turn verified revenue into one next experiment.",
      action: "Open experiment",
      view: "experiment",
      complete: hasRecommendation,
    },
  ];
}
