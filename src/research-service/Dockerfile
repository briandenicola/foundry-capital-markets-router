FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props Directory.Packages.props global.json ./
COPY src/Fcmr.Research.Domain/ src/Fcmr.Research.Domain/
COPY src/Fcmr.ServiceDefaults/ src/Fcmr.ServiceDefaults/
COPY src/research-service/ src/research-service/

RUN dotnet publish src/research-service/research-service.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080

# Non-root. The image is never granted the Development environment, so the authorisation switch in
# appsettings.Development.json is unreachable from anything that ships; scripts/policy-no-development-environment.sh
# fails the build if a deployment artefact ever selects it.
USER $APP_UID

ENTRYPOINT ["dotnet", "Fcmr.ResearchService.dll"]
