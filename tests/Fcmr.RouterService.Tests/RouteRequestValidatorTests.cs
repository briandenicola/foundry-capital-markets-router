using System.Text.Json;
using Fcmr.Router.Decisions;
using Fcmr.RouterService.Contracts;
using FluentAssertions;
using Xunit;

namespace Fcmr.RouterService.Tests;

public sealed class RouteRequestValidatorTests
{
    private static RouteRequest Valid() => new()
    {
        Lane = Lane.Research,
        TaskKind = "synthesize",
        CostCeilingUsd = 0.25m,
        LatencyBudgetMs = 8000,
        DataClassification = DataClassification.Internal,
        ComplexityHints = new ComplexityHintsDto
        {
            InputTokenEstimate = 12_000,
            RequiresMultiStep = true,
            RequiresRetrieval = true,
        },
    };

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    [Fact]
    public void Accepts_a_well_formed_request()
    {
        RouteRequestValidator.Validate(Valid()).Should().BeEmpty();
    }

    [Fact]
    public void Requires_a_data_classification_and_never_assumes_one()
    {
        var errors = RouteRequestValidator.Validate(Valid() with { DataClassification = null });

        errors.Should().ContainSingle().Which.Should().Contain("dataClassification");
    }

    [Fact]
    public void Requires_lane_task_kind_ceiling_and_hints()
    {
        var errors = RouteRequestValidator.Validate(new RouteRequest());

        errors.Should().HaveCount(5);
        errors.Should().Contain(e => e.StartsWith("lane", StringComparison.Ordinal));
        errors.Should().Contain(e => e.StartsWith("taskKind", StringComparison.Ordinal));
        errors.Should().Contain(e => e.StartsWith("costCeilingUsd", StringComparison.Ordinal));
        errors.Should().Contain(e => e.StartsWith("dataClassification", StringComparison.Ordinal));
        errors.Should().Contain(e => e.StartsWith("complexityHints", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Rejects_a_non_positive_cost_ceiling(int ceiling)
    {
        var errors = RouteRequestValidator.Validate(Valid() with { CostCeilingUsd = ceiling });

        errors.Should().ContainSingle().Which.Should().Contain("greater than zero");
    }

    [Fact]
    public void Rejects_a_negative_token_estimate()
    {
        var errors = RouteRequestValidator.Validate(Valid() with
        {
            ComplexityHints = new ComplexityHintsDto { InputTokenEstimate = -1 },
        });

        errors.Should().ContainSingle().Which.Should().Contain("inputTokenEstimate");
    }

    [Fact]
    public void Rejects_an_unusable_correlation_id()
    {
        var errors = RouteRequestValidator.Validate(Valid() with { CorrelationId = "not a valid id" });

        errors.Should().ContainSingle().Which.Should().Contain("correlationId");
    }

    // ---- Principle IV: no application names a model ----

    [Theory]
    [InlineData("""{ "model": "gpt-5.6-sol" }""")]
    [InlineData("""{ "deployment": "gpt-5.4" }""")]
    [InlineData("""{ "vendor": "Anthropic" }""")]
    [InlineData("""{ "tier": "Premium" }""")]
    [InlineData("""{ "modelName": "gpt-5.4" }""")]
    [InlineData("""{ "model_id": "gpt-5.4" }""")]
    [InlineData("""{ "provider": "XAI" }""")]
    public void Rejects_a_payload_that_names_a_model(string payload)
    {
        var errors = RouteRequestValidator.Validate(Valid() with { Payload = Json(payload) });

        errors.Should().ContainSingle().Which.Should().Contain("not permitted");
    }

    [Fact]
    public void Rejects_a_model_name_smuggled_below_the_top_level()
    {
        var payload = Json("""{ "question": "...", "options": { "advanced": { "deployment": "gpt-5.6-sol" } } }""");

        var errors = RouteRequestValidator.Validate(Valid() with { Payload = payload });

        errors.Should().ContainSingle().Which.Should().Contain("deployment");
    }

    [Fact]
    public void Rejects_a_model_name_smuggled_inside_an_array()
    {
        var payload = Json("""{ "steps": [ { "prompt": "..." }, { "model": "gpt-5.4" } ] }""");

        var errors = RouteRequestValidator.Validate(Valid() with { Payload = payload });

        errors.Should().ContainSingle();
    }

    [Fact]
    public void Leaves_an_innocent_lane_payload_alone()
    {
        var payload = Json("""{ "question": "What drove the move in 10y yields?", "modelling": "unaffected" }""");

        RouteRequestValidator.Validate(Valid() with { Payload = payload }).Should().BeEmpty();
    }

    // ---- The screen must fail closed, at depth and on near-miss spellings ----

    /// <summary>
    /// Builds a payload with a single chain of objects, placing <paramref name="leafKey"/> at
    /// <paramref name="depth"/> levels below the payload root.
    /// </summary>
    private static JsonElement Nested(int depth, string leafKey)
    {
        var json = $$"""{"{{leafKey}}": "gpt-5.6-sol"}""";
        for (var i = 0; i < depth; i++)
        {
            json = $$"""{"level{{i}}": {{json}}}""";
        }

        return Json(json);
    }

    [Fact]
    public void Catches_a_model_key_at_the_deepest_screenable_level()
    {
        var errors = RouteRequestValidator.Validate(Valid() with { Payload = Nested(7, "model") });

        errors.Should().ContainSingle().Which.Should().Contain("not permitted");
    }

    /// <summary>
    /// The hole Saul found. Before this, exceeding the depth limit returned silently and a model
    /// key below it passed validation unexamined, so the caller received a 200 that read as
    /// clearance for a request that was never screened.
    /// </summary>
    [Fact]
    public void Refuses_a_payload_too_deep_to_screen_rather_than_passing_it()
    {
        var errors = RouteRequestValidator.Validate(Valid() with { Payload = Nested(12, "model") });

        errors.Should().NotBeEmpty();
        errors.Should().Contain(e => e.Contains("cannot be screened", StringComparison.Ordinal));
    }

    [Fact]
    public void Refuses_an_over_deep_payload_even_when_it_names_no_model()
    {
        var errors = RouteRequestValidator.Validate(Valid() with { Payload = Nested(12, "question") });

        errors.Should().ContainSingle().Which.Should().Contain("cannot be screened");
    }

    [Fact]
    public void Refuses_a_payload_made_deep_through_arrays()
    {
        var json = """{"model": "gpt-5.6-sol"}""";
        for (var i = 0; i < 12; i++)
        {
            json = $"[{json}]";
        }

        var errors = RouteRequestValidator.Validate(Valid() with { Payload = Json(json) });

        errors.Should().NotBeEmpty();
    }

    [Theory]
    [InlineData("model-name")]
    [InlineData("model.name")]
    [InlineData("targetDeployment")]
    [InlineData("azureOpenAIDeployment")]
    [InlineData("preferredModel")]
    [InlineData("MODEL_ID")]
    [InlineData("llmChoice")]
    [InlineData("engineOverride")]
    [InlineData("pricingTierPreference")]
    public void Catches_a_model_name_however_it_is_spelled(string key)
    {
        var payload = Json($$"""{ "{{key}}": "gpt-5.6-sol" }""");

        var errors = RouteRequestValidator.Validate(Valid() with { Payload = payload });

        errors.Should().ContainSingle().Which.Should().Contain("not permitted");
    }

    [Theory]
    [InlineData("modelling")]
    [InlineData("modeling")]
    [InlineData("riskModellingNotes")]
    public void Does_not_catch_words_that_merely_contain_a_fragment(string key)
    {
        var payload = Json($$"""{ "{{key}}": "unaffected" }""");

        RouteRequestValidator.Validate(Valid() with { Payload = payload }).Should().BeEmpty();
    }

    [Fact]
    public void Reports_every_problem_at_once()
    {
        var errors = RouteRequestValidator.Validate(new RouteRequest
        {
            CostCeilingUsd = -1m,
            Payload = Json("""{ "model": "gpt-5.4" }"""),
        });

        errors.Should().HaveCountGreaterThan(3);
    }
}
