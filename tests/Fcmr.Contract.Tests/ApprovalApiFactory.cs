using System.Reflection;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Fcmr.Contract.Tests;

/// <summary>
/// Hosts the approval API in process, once one exists.
///
/// T-018 has not landed: no assembly in this solution serves
/// <c>specs/001-router-core/contracts/approval-api.md</c>. Every test in
/// <see cref="ApprovalContractTests"/> therefore fails at construction with a single, specific
/// message rather than a pile of connection errors. That is the intended red state for a suite
/// written from the contract ahead of the implementation.
///
/// Two contract gaps also block these tests independently of the missing host. Both are recorded
/// in <c>CONTRACT-FINDINGS.md</c> and neither is resolved here, because picking an interpretation
/// silently is how an ambiguous contract survives to the demo:
///
/// 1. The contract has no affordance for creating a proposal, so a caller — including this suite —
///    cannot reach the PendingApproval state it then makes assertions about.
/// 2. The contract never says how <c>decidedByObjectId</c> is derived from the caller, so the
///    segregation-of-duties test cannot present a proposer identity and an approver identity as
///    two distinguishable callers.
/// </summary>
public sealed class ApprovalApiFactory : IDisposable
{
    /// <summary>
    /// Candidate assembly names for an approval host, in the order T-018 is most likely to use.
    /// Probing several rather than one avoids a false "missing surface" report if the service is
    /// named differently from the guess made here.
    /// </summary>
    private static readonly string[] CandidateAssemblies =
    [
        "Fcmr.ApprovalsService",
        "Fcmr.Approvals.Api",
        "Fcmr.Approvals.Service",
        "approvals-service",
    ];

    private readonly IDisposable? inner;

    public ApprovalApiFactory()
    {
        foreach (var name in CandidateAssemblies)
        {
            Assembly assembly;
            try
            {
                assembly = Assembly.Load(name);
            }
            catch (Exception ex) when (ex is FileNotFoundException or BadImageFormatException)
            {
                continue;
            }

            var entryPoint = assembly.EntryPoint?.DeclaringType;
            if (entryPoint is null)
            {
                continue;
            }

            var factoryType = typeof(WebApplicationFactory<>).MakeGenericType(entryPoint);
            inner = (IDisposable)Activator.CreateInstance(factoryType)!;
            Client = (HttpClient)factoryType
                .GetMethod(nameof(WebApplicationFactory<object>.CreateClient), Type.EmptyTypes)!
                .Invoke(inner, null)!;
            return;
        }

        throw new ContractSurfaceMissingException(
            "No approval API host exists in this solution, so contracts/approval-api.md cannot be " +
            "exercised over HTTP. This is T-018 outstanding, not a disagreement between the " +
            "implementation and the contract. Assemblies probed: " +
            string.Join(", ", CandidateAssemblies) + ".");
    }

    public HttpClient Client { get; } = null!;

    public void Dispose()
    {
        Client?.Dispose();
        inner?.Dispose();
    }
}
