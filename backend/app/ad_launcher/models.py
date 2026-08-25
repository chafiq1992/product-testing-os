from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AudiencePlan(StrictModel):
    country_codes: list[str] = Field(min_length=1, max_length=5)
    age_min: int = Field(ge=18, le=65)
    age_max: int = Field(ge=18, le=65)
    gender: Literal["all", "women", "men"] = "all"
    audience_label: str = Field(min_length=3, max_length=120)
    rationale: str = Field(min_length=10, max_length=800)
    broadness_explanation: str = Field(min_length=10, max_length=800)

    @field_validator("country_codes")
    @classmethod
    def normalize_countries(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(str(item).strip().upper() for item in value if str(item).strip()))

    @model_validator(mode="after")
    def validate_age_span(self):
        if self.age_max < self.age_min:
            raise ValueError("age_max must be greater than or equal to age_min")
        return self


class ProductAnalysis(StrictModel):
    product_summary: str = Field(min_length=20, max_length=1400)
    primary_buyer: str = Field(min_length=5, max_length=400)
    main_problem: str = Field(min_length=5, max_length=500)
    desired_outcome: str = Field(min_length=5, max_length=500)
    strongest_verified_benefits: list[str] = Field(min_length=2, max_length=8)
    verified_proof: list[str] = Field(default_factory=list, max_length=8)
    objections: list[str] = Field(min_length=2, max_length=8)
    prohibited_or_unsupported_claims: list[str] = Field(default_factory=list, max_length=10)


class LandingAnalysis(StrictModel):
    language: str = Field(min_length=2, max_length=40)
    message_match: str = Field(min_length=10, max_length=800)
    conversion_strengths: list[str] = Field(default_factory=list, max_length=8)
    conversion_risks: list[str] = Field(default_factory=list, max_length=8)
    destination_is_ready: bool


class CreativeAnalysis(StrictModel):
    detected_format: Literal["image", "video", "carousel"]
    visual_summary: str = Field(min_length=10, max_length=1000)
    strengths: list[str] = Field(default_factory=list, max_length=8)
    weaknesses: list[str] = Field(default_factory=list, max_length=8)
    first_three_seconds: str = Field(default="Not applicable", max_length=600)
    mobile_readability: str = Field(min_length=5, max_length=600)


class AdSetDraft(StrictModel):
    name: str = Field(min_length=4, max_length=150)
    origin: Literal["uploaded", "ai_generated"]
    angle: str = Field(min_length=4, max_length=180)
    headline_ar: str = Field(min_length=4, max_length=90)
    primary_text_ar: str = Field(min_length=20, max_length=700)
    description_ar: str = Field(min_length=2, max_length=120)
    call_to_action: Literal["SHOP_NOW"] = "SHOP_NOW"
    rationale: str = Field(min_length=10, max_length=600)
    image_prompt: str | None = Field(default=None, max_length=3500)


class CampaignDraft(StrictModel):
    campaign_name: str = Field(min_length=4, max_length=180)
    product_analysis: ProductAnalysis
    landing_analysis: LandingAnalysis
    creative_analysis: CreativeAnalysis
    audience: AudiencePlan
    adsets: list[AdSetDraft] = Field(min_length=3, max_length=5)
    testing_hypothesis: str = Field(min_length=20, max_length=1000)
    operator_notes: list[str] = Field(default_factory=list, max_length=10)


class ReviewDecision(StrictModel):
    approved: bool
    score: int = Field(ge=0, le=100)
    summary: str = Field(min_length=10, max_length=1000)
    blockers: list[str] = Field(default_factory=list, max_length=15)
    factuality_findings: list[str] = Field(default_factory=list, max_length=12)
    creative_findings: list[str] = Field(default_factory=list, max_length=12)
    copy_findings: list[str] = Field(default_factory=list, max_length=12)
    audience_findings: list[str] = Field(default_factory=list, max_length=12)
    required_fixes: list[str] = Field(default_factory=list, max_length=12)


class LaunchConfirmation(StrictModel):
    store: str
    confirm: bool = False


class MediaAsset(StrictModel):
    filename: str
    url: str
    content_type: str
    size: int = Field(ge=1)
    kind: Literal["image", "video"]
    source: Literal["uploaded", "ai_generated"] = "uploaded"
    width: int | None = Field(default=None, ge=1)
    height: int | None = Field(default=None, ge=1)


class PreparedAdSet(StrictModel):
    name: str
    ad_name: str = ""
    origin: Literal["uploaded", "ai_generated"]
    angle: str
    headline_ar: str
    primary_text_ar: str
    description_ar: str
    call_to_action: Literal["SHOP_NOW"] = "SHOP_NOW"
    rationale: str
    media_type: Literal["image", "video", "carousel"]
    media_urls: list[str] = Field(min_length=1, max_length=10)
    image_prompt: str | None = None


class PreparedCampaign(StrictModel):
    campaign_name: str
    product_id: str
    product_title: str
    landing_url: str
    store: str
    meta_ad_account_id: str | None = None
    timezone: str
    scheduled_start: str
    total_daily_budget_usd: float = Field(gt=0)
    audience: AudiencePlan
    adsets: list[PreparedAdSet] = Field(min_length=3, max_length=5)
    analysis: CampaignDraft
