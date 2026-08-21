using FluentAssertions;
using Fcmr.ServiceDefaults.Correlation;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Fcmr.RouterService.Tests;

public sealed class CorrelationIdMiddlewareTests
{
    private static async Task<(HttpContext Context, CorrelationIdAccessor Accessor)> RunAsync(
        Action<HttpContext>? arrange = null,
        RequestDelegate? next = null)
    {
        var context = new DefaultHttpContext();
        var response = new RecordingResponseFeature();
        context.Features.Set<IHttpResponseFeature>(response);
        arrange?.Invoke(context);

        var accessor = new CorrelationIdAccessor();
        var middleware = new CorrelationIdMiddleware(
            next ?? (_ => Task.CompletedTask),
            NullLogger<CorrelationIdMiddleware>.Instance);

        await middleware.InvokeAsync(context, accessor);

        // DefaultHttpContext's stock response feature discards OnStarting callbacks, so the
        // recording feature runs them the way a real server would when the response begins.
        await response.FireOnStartingAsync();

        return (context, accessor);
    }

    [Fact]
    public async Task Generates_an_id_when_the_caller_supplies_none()
    {
        var (context, accessor) = await RunAsync();

        accessor.Source.Should().Be(CorrelationIdSource.Generated);
        Guid.TryParse(accessor.Value, out _).Should().BeTrue();
        context.Response.Headers[CorrelationIdFormat.HeaderName].ToString().Should().Be(accessor.Value);
    }

    [Fact]
    public async Task Honours_a_caller_supplied_header()
    {
        const string supplied = "b6b1f0a2-0000-0000-0000-000000000000";

        var (context, accessor) = await RunAsync(c =>
            c.Request.Headers[CorrelationIdFormat.HeaderName] = supplied);

        accessor.Source.Should().Be(CorrelationIdSource.Header);
        accessor.Value.Should().Be(supplied);
        context.Response.Headers[CorrelationIdFormat.HeaderName].ToString().Should().Be(supplied);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("has space")]
    [InlineData("carriage\rreturn")]
    [InlineData("newline\ninjected")]
    [InlineData("semi;colon")]
    public async Task Rejects_an_unusable_header_and_generates_instead(string supplied)
    {
        var (_, accessor) = await RunAsync(c =>
            c.Request.Headers[CorrelationIdFormat.HeaderName] = supplied);

        accessor.Source.Should().Be(CorrelationIdSource.Generated);
        accessor.Value.Should().NotBe(supplied);
    }

    [Fact]
    public async Task Rejects_a_header_longer_than_the_maximum()
    {
        var supplied = new string('a', CorrelationIdFormat.MaxLength + 1);

        var (_, accessor) = await RunAsync(c =>
            c.Request.Headers[CorrelationIdFormat.HeaderName] = supplied);

        accessor.Source.Should().Be(CorrelationIdSource.Generated);
    }

    [Fact]
    public async Task Echoes_an_id_the_endpoint_adopted_from_the_request_body()
    {
        const string fromBody = "body-supplied-id";

        var context = new DefaultHttpContext();
        var response = new RecordingResponseFeature();
        context.Features.Set<IHttpResponseFeature>(response);
        var accessor = new CorrelationIdAccessor();

        var middleware = new CorrelationIdMiddleware(
            _ =>
            {
                // Stands in for the endpoint, which is the first thing able to read the body.
                accessor.TryAdoptFromBody(fromBody);
                return Task.CompletedTask;
            },
            NullLogger<CorrelationIdMiddleware>.Instance);

        await middleware.InvokeAsync(context, accessor);
        await response.FireOnStartingAsync();

        // The header is written on OnStarting, so a late adoption still reaches the caller.
        context.Response.Headers[CorrelationIdFormat.HeaderName].ToString().Should().Be(fromBody);
    }

    [Fact]
    public async Task Attaches_the_id_even_when_the_pipeline_throws()
    {
        var context = new DefaultHttpContext();
        var accessor = new CorrelationIdAccessor();
        var middleware = new CorrelationIdMiddleware(
            _ => throw new InvalidOperationException("downstream failure"),
            NullLogger<CorrelationIdMiddleware>.Instance);

        var act = async () => await middleware.InvokeAsync(context, accessor);

        await act.Should().ThrowAsync<InvalidOperationException>();
        accessor.Value.Should().NotBeNullOrWhiteSpace();
    }
}

public sealed class CorrelationIdAccessorTests
{
    private static CorrelationIdAccessor WithHeader(string value)
    {
        var accessor = new CorrelationIdAccessor();
        accessor.Establish(value, CorrelationIdSource.Header);
        return accessor;
    }

    private static CorrelationIdAccessor Generated(string value)
    {
        var accessor = new CorrelationIdAccessor();
        accessor.Establish(value, CorrelationIdSource.Generated);
        return accessor;
    }

    [Fact]
    public void Adopts_a_body_id_over_a_generated_one()
    {
        var accessor = Generated("generated-id");

        accessor.TryAdoptFromBody("caller-id").Should().BeTrue();
        accessor.Value.Should().Be("caller-id");
        accessor.Source.Should().Be(CorrelationIdSource.Body);
    }

    [Fact]
    public void Refuses_a_body_id_that_contradicts_a_caller_supplied_header()
    {
        var accessor = WithHeader("header-id");

        accessor.TryAdoptFromBody("different-id").Should().BeFalse();
        accessor.Value.Should().Be("header-id");
    }

    [Fact]
    public void Accepts_a_body_id_that_agrees_with_the_header()
    {
        var accessor = WithHeader("same-id");

        accessor.TryAdoptFromBody("same-id").Should().BeTrue();
        accessor.Source.Should().Be(CorrelationIdSource.Header);
    }

    [Fact]
    public void Ignores_an_absent_or_unusable_body_id()
    {
        var accessor = WithHeader("header-id");

        accessor.TryAdoptFromBody(null).Should().BeTrue();
        accessor.TryAdoptFromBody("not a valid id").Should().BeTrue();
        accessor.Value.Should().Be("header-id");
    }

    [Fact]
    public void Formats_as_its_current_value_so_log_scopes_pick_up_a_late_adoption()
    {
        var accessor = Generated("first");
        accessor.TryAdoptFromBody("second");

        accessor.ToString().Should().Be("second");
    }
}

/// <summary>
/// A response feature that actually runs its OnStarting callbacks.
///
/// DefaultHttpContext's stock feature accepts them and drops them on the floor, which would let a
/// middleware that never wrote the header pass every test in this file.
/// </summary>
internal sealed class RecordingResponseFeature : IHttpResponseFeature
{
    private readonly List<(Func<object, Task> Callback, object State)> _onStarting = [];

    public int StatusCode { get; set; } = 200;

    public string? ReasonPhrase { get; set; }

    public IHeaderDictionary Headers { get; set; } = new HeaderDictionary();

    public Stream Body { get; set; } = Stream.Null;

    public bool HasStarted { get; private set; }

    public void OnStarting(Func<object, Task> callback, object state) => _onStarting.Add((callback, state));

    public void OnCompleted(Func<object, Task> callback, object state)
    {
    }

    public async Task FireOnStartingAsync()
    {
        HasStarted = true;
        foreach (var (callback, state) in _onStarting)
        {
            await callback(state);
        }
    }
}
